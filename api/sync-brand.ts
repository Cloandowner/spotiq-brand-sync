import { connect } from "framer-api"

type Brand = Record<string, unknown>

type Env = {
    SYNC_SECRET?: string
    FRAMER_PROJECT_URL?: string
    FRAMER_API_KEY?: string
    SUPABASE_URL?: string
    SUPABASE_SERVICE_ROLE_KEY?: string
}

const env = (globalThis as any).process?.env as Env | undefined

function hasValue(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0
}

function asString(value: unknown): string | undefined {
    return hasValue(value) ? value.trim() : undefined
}

export default {
    async fetch(request: Request) {
        if (request.method !== "POST") {
            return Response.json(
                {
                    success: false,
                    error: "Only POST requests are allowed",
                },
                { status: 405 }
            )
        }

        let framer: any = null

        try {
            // ------------------------------------------------------------
            // Environment variables
            // ------------------------------------------------------------

            const syncSecret = env?.SYNC_SECRET
            const projectUrl = env?.FRAMER_PROJECT_URL
            const framerApiKey = env?.FRAMER_API_KEY
            const supabaseUrl = env?.SUPABASE_URL
            const supabaseServiceKey =
                env?.SUPABASE_SERVICE_ROLE_KEY

            if (!syncSecret) {
                throw new Error("SYNC_SECRET ontbreekt")
            }

            if (request.headers.get("x-sync-secret") !== syncSecret) {
                return Response.json(
                    {
                        success: false,
                        error: "Unauthorized",
                    },
                    { status: 401 }
                )
            }

            if (!projectUrl) {
                throw new Error("FRAMER_PROJECT_URL ontbreekt")
            }

            if (!framerApiKey) {
                throw new Error("FRAMER_API_KEY ontbreekt")
            }

            if (!supabaseUrl) {
                throw new Error("SUPABASE_URL ontbreekt")
            }

            if (!supabaseServiceKey) {
                throw new Error(
                    "SUPABASE_SERVICE_ROLE_KEY ontbreekt"
                )
            }

            // ------------------------------------------------------------
            // Get brands from Supabase
            // ------------------------------------------------------------

            const brandsResponse = await fetch(
                `${supabaseUrl}/rest/v1/brands?select=*`,
                {
                    headers: {
                        apikey: supabaseServiceKey,
                        Authorization: `Bearer ${supabaseServiceKey}`,
                    },
                }
            )

            if (!brandsResponse.ok) {
                throw new Error(
                    `Supabase kon brands niet lezen: ${await brandsResponse.text()}`
                )
            }

            const brands = (await brandsResponse.json()) as Brand[]

            // ------------------------------------------------------------
            // Connect to Framer
            // ------------------------------------------------------------

            framer = await connect(
                projectUrl,
                framerApiKey
            )

            // ------------------------------------------------------------
            // Find collection
            // ------------------------------------------------------------

            const collections = await framer.getCollections()

            const collection = collections.find(
                (item: any) =>
                    item?.name?.trim().toLowerCase() ===
                    "discover brands"
            )

            if (!collection) {
                throw new Error(
                    'Framer collection "Discover Brands" niet gevonden'
                )
            }

            // ------------------------------------------------------------
            // Get fields and existing items
            // ------------------------------------------------------------

            const fields = await collection.getFields()
            const existingItems = await collection.getItems()

            const fieldByName = new Map<string, any>()

            for (const field of fields) {
                if (field?.name) {
                    fieldByName.set(
                        field.name.trim().toLowerCase(),
                        field
                    )
                }
            }

            const existingBySlug = new Map<string, any>()

            for (const item of existingItems) {
                if (hasValue(item?.slug)) {
                    existingBySlug.set(item.slug, item)
                }
            }

            // ------------------------------------------------------------
            // Results
            // ------------------------------------------------------------

            const synced: string[] = []
            const added: string[] = []
            const updated: string[] = []
            const skippedFields: string[] = []

            // ------------------------------------------------------------
            // Set a field based on the ACTUAL Framer field type
            // ------------------------------------------------------------

            const setField = (
                fieldData: Record<string, unknown>,
                fieldName: string,
                value: unknown
            ) => {
                const field = fieldByName.get(
                    fieldName.trim().toLowerCase()
                )

                if (!field) {
                    return
                }

                if (value === null || value === undefined) {
                    return
                }

                // --------------------------------------------------------
                // Boolean
                // --------------------------------------------------------

                if (field.type === "boolean") {
                    fieldData[field.id] = {
                        type: "boolean",
                        value: Boolean(value),
                    }

                    return
                }

                // --------------------------------------------------------
                // String
                // --------------------------------------------------------

                if (field.type === "string") {
                    const stringValue = asString(value)

                    if (!stringValue) {
                        return
                    }

                    fieldData[field.id] = {
                        type: "string",
                        value: stringValue,
                    }

                    return
                }

                // --------------------------------------------------------
                // Link
                // --------------------------------------------------------

                if (field.type === "link") {
                    const stringValue = asString(value)

                    if (!stringValue) {
                        return
                    }

                    fieldData[field.id] = {
                        type: "link",
                        value: stringValue,
                    }

                    return
                }

                // --------------------------------------------------------
                // Image
                // --------------------------------------------------------

                if (field.type === "image") {
                    const stringValue = asString(value)

                    if (!stringValue) {
                        return
                    }

                    fieldData[field.id] = {
                        type: "image",
                        value: stringValue,
                    }

                    return
                }

                // --------------------------------------------------------
                // ENUM
                //
                // Framer enum fields require the ID of one of their
                // predefined cases.
                // --------------------------------------------------------

                if (field.type === "enum") {
                    const stringValue = asString(value)

                    if (!stringValue) {
                        return
                    }

                    const cases = Array.isArray(field.cases)
                        ? field.cases
                        : []

                    const matchingCase = cases.find(
                        (enumCase: any) => {
                            const caseName =
                                asString(enumCase?.name)

                            const caseId =
                                asString(enumCase?.id)

                            return (
                                caseId === stringValue ||
                                caseName?.toLowerCase() ===
                                    stringValue.toLowerCase()
                            )
                        }
                    )

                    if (!matchingCase) {
                        skippedFields.push(
                            `${fieldName}: ${stringValue}`
                        )
                        return
                    }

                    fieldData[field.id] = {
                        type: "enum",
                        value: matchingCase.id,
                    }

                    return
                }

                // --------------------------------------------------------
                // Unsupported field type
                // --------------------------------------------------------

                skippedFields.push(
                    `${fieldName}: unsupported Framer type "${field.type}"`
                )
            }

            // ------------------------------------------------------------
            // Build items
            // ------------------------------------------------------------

            const itemsToSync = brands
                .filter(
                    (brand) =>
                        hasValue(brand.slug) &&
                        hasValue(brand.name)
                )
                .map((brand) => {
                    const slug = asString(brand.slug)!
                    const existingItem =
                        existingBySlug.get(slug)

                    const fieldData: Record<string, unknown> = {}

                    // ----------------------------------------------------
                    // Brand Name
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Brand Name",
                        brand.name
                    )

                    // ----------------------------------------------------
                    // Status
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Status",
                        brand.status
                    )

                    // ----------------------------------------------------
                    // Category
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Category",
                        brand.category
                    )

                    // ----------------------------------------------------
                    // Description
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Description",
                        brand.description
                    )

                    // ----------------------------------------------------
                    // Logo
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Logo",
                        brand.logo_url
                    )

                    // ----------------------------------------------------
                    // Products
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Product 1",
                        brand.image_1_url
                    )

                    setField(
                        fieldData,
                        "Product 2",
                        brand.image_2_url
                    )

                    setField(
                        fieldData,
                        "Product 3",
                        brand.image_3_url
                    )

                    // ----------------------------------------------------
                    // Links
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Website URL",
                        brand.website
                    )

                    setField(
                        fieldData,
                        "Instagram",
                        brand.instagram
                    )

                    // ----------------------------------------------------
                    // Country
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Country",
                        brand.country
                    )

                    // ----------------------------------------------------
                    // Featured
                    // ----------------------------------------------------

                    setField(
                        fieldData,
                        "Featured",
                        brand.featured ?? false
                    )

                    // ----------------------------------------------------
                    // Create/update CMS item
                    // ----------------------------------------------------

                    const item: Record<string, unknown> = {
                        slug,
                        fieldData,
                    }

                    if (existingItem?.id) {
                        item.id = existingItem.id
                        updated.push(slug)
                    } else {
                        added.push(slug)
                    }

                    synced.push(slug)

                    return item
                })

            // ------------------------------------------------------------
            // Send to Framer
            // ------------------------------------------------------------

            if (itemsToSync.length > 0) {
                await collection.addItems(itemsToSync)
            }

            // ------------------------------------------------------------
            // Existing Framer items not present in Supabase
            // ------------------------------------------------------------

            const unchangedExistingItems = existingItems
                .filter(
                    (item: any) =>
                        !synced.includes(item.slug)
                )
                .map((item: any) => item.slug)
                .filter(Boolean)

            // ------------------------------------------------------------
            // Success
            // ------------------------------------------------------------

            return Response.json({
                success: true,
                message:
                    "Supabase brands zijn naar Framer gesynchroniseerd.",
                collection: "Discover Brands",
                supabaseBrands: brands.length,
                synced: synced.length,
                added,
                updated,
                unchangedExistingItems,
                skippedFields,
            })
        } catch (error) {
            console.error("Brand sync failed:", error)

            return Response.json(
                {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                },
                { status: 500 }
            )
        } finally {
            try {
                await framer?.disconnect()
            } catch (error) {
                console.error(
                    "Framer disconnect failed:",
                    error
                )
            }
        }
    },
}
