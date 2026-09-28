import { connect } from "framer-api"

type Brand = Record<string, unknown>

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
            // 1. Security
            // ------------------------------------------------------------

            const syncSecret = process.env.SYNC_SECRET

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

            // ------------------------------------------------------------
            // 2. Environment variables
            // ------------------------------------------------------------

            const projectUrl = process.env.FRAMER_PROJECT_URL
            const framerApiKey = process.env.FRAMER_API_KEY
            const supabaseUrl = process.env.SUPABASE_URL
            const supabaseServiceKey =
                process.env.SUPABASE_SERVICE_ROLE_KEY

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
            // 3. Get brands from Supabase
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
                const errorText = await brandsResponse.text()

                throw new Error(
                    `Supabase kon brands niet lezen: ${errorText}`
                )
            }

            const brands = (await brandsResponse.json()) as Brand[]

            // ------------------------------------------------------------
            // 4. Connect to Framer
            // ------------------------------------------------------------

            framer = await connect(projectUrl, framerApiKey)

            // ------------------------------------------------------------
            // 5. Find Discover Brands collection
            // ------------------------------------------------------------

            const collections = await framer.getCollections()

            const collection = collections.find(
                (item: any) =>
                    item.name?.toLowerCase() ===
                    "discover brands".toLowerCase()
            )

            if (!collection) {
                throw new Error(
                    'Framer collection "Discover Brands" niet gevonden'
                )
            }

            // ------------------------------------------------------------
            // 6. Get fields and existing CMS items
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
            // 7. Counters
            // ------------------------------------------------------------

            const synced: string[] = []
            const added: string[] = []
            const updated: string[] = []
            const skipped: string[] = []

            // ------------------------------------------------------------
            // 8. Convert Supabase brands to Framer CMS items
            // ------------------------------------------------------------

            const itemsToSync = brands
                .filter((brand) => {
                    const slug = asString(brand.slug)
                    const name = asString(brand.name)

                    if (!slug || !name) {
                        return false
                    }

                    return true
                })
                .map((brand) => {
                    const slug = asString(brand.slug)!
                    const name = asString(brand.name)!

                    const existingItem = existingBySlug.get(slug)

                    const fieldData: Record<string, unknown> = {}

                    // ----------------------------------------------------
                    // Helper to safely set a Framer field
                    // ----------------------------------------------------

                    const setField = (
                        framerFieldName: string,
                        type:
                            | "string"
                            | "image"
                            | "link"
                            | "boolean",
                        value: unknown
                    ) => {
                        const field = fieldByName.get(
                            framerFieldName.trim().toLowerCase()
                        )

                        // Field does not exist in Framer.
                        // Ignore it instead of breaking the whole sync.
                        if (!field) {
                            return
                        }

                        if (type === "boolean") {
                            fieldData[field.id] = {
                                type,
                                value: Boolean(value),
                            }

                            return
                        }

                        const stringValue = asString(value)

                        if (!stringValue) {
                            return
                        }

                        fieldData[field.id] = {
                            type,
                            value: stringValue,
                        }
                    }

                    // ----------------------------------------------------
                    // Framer CMS fields
                    // ----------------------------------------------------

                    setField(
                        "Brand Name",
                        "string",
                        name
                    )

                    setField(
                        "Status",
                        "string",
                        brand.status
                    )

                    setField(
                        "Category",
                        "string",
                        brand.category
                    )

                    setField(
                        "Description",
                        "string",
                        brand.description
                    )

                    setField(
                        "Logo",
                        "image",
                        brand.logo_url
                    )

                    setField(
                        "Product 1",
                        "image",
                        brand.image_1_url
                    )

                    setField(
                        "Product 2",
                        "image",
                        brand.image_2_url
                    )

                    setField(
                        "Product 3",
                        "image",
                        brand.image_3_url
                    )

                    setField(
                        "Website URL",
                        "link",
                        brand.website
                    )

                    setField(
                        "Instagram",
                        "link",
                        brand.instagram
                    )

                    setField(
                        "Country",
                        "string",
                        brand.country
                    )

                    setField(
                        "Featured",
                        "boolean",
                        brand.featured ?? false
                    )

                    // ----------------------------------------------------
                    // Keep slug as the Framer CMS item slug.
                    //
                    // For existing items we include the ID so Framer
                    // updates the existing item instead of creating a
                    // duplicate.
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
            // 9. Send items to Framer
            // ------------------------------------------------------------

            if (itemsToSync.length > 0) {
                await collection.addItems(itemsToSync)
            }

            // ------------------------------------------------------------
            // 10. Find existing Framer items that were not in Supabase
            // ------------------------------------------------------------

            const unchangedExistingItems = existingItems
                .filter(
                    (item: any) =>
                        !synced.includes(item.slug)
                )
                .map((item: any) => item.slug)
                .filter(Boolean)

            // ------------------------------------------------------------
            // 11. Return result
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
                skipped,
                note:
                    "De CMS-items zijn toegevoegd of bijgewerkt. Publicatie naar de live site gebeurt niet automatisch.",
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
            } catch (disconnectError) {
                console.error(
                    "Framer disconnect failed:",
                    disconnectError
                )
            }
        }
    },
}
