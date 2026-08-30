import { connect } from "framer-api"

type Brand = Record<string, unknown>

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json(
        { success: false, error: "Only POST requests are allowed" },
        { status: 405 }
      )
    }

    let framer: any

    try {
      const syncSecret = process.env.SYNC_SECRET

      if (!syncSecret) throw new Error("SYNC_SECRET ontbreekt")

      if (request.headers.get("x-sync-secret") !== syncSecret) {
        return Response.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        )
      }

      const projectUrl = process.env.FRAMER_PROJECT_URL
      const framerApiKey = process.env.FRAMER_API_KEY
      const supabaseUrl = process.env.SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (!projectUrl) throw new Error("FRAMER_PROJECT_URL ontbreekt")
      if (!framerApiKey) throw new Error("FRAMER_API_KEY ontbreekt")
      if (!supabaseUrl) throw new Error("SUPABASE_URL ontbreekt")
      if (!supabaseServiceKey) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt")
      }

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

      framer = await connect(projectUrl, framerApiKey)

      const collections = await framer.getCollections()
      const collection = collections.find(
        (item: any) => item.name === "Discover Brands"
      )

      if (!collection) {
        throw new Error('Framer collection "Discover Brands" niet gevonden')
      }

      const fields = await collection.getFields()
      const existingItems = await collection.getItems()

      const fieldByName = new Map(
        fields.map((field: any) => [field.name.toLowerCase(), field])
      )

      const existingBySlug = new Map(
        existingItems.map((item: any) => [item.slug, item])
      )

      const synced: string[] = []
      const added: string[] = []
      const updated: string[] = []

      const itemsToSync = brands
        .filter((brand) => hasValue(brand.slug) && hasValue(brand.name))
        .map((brand) => {
          const slug = brand.slug as string
          const existingItem = existingBySlug.get(slug)
          const fieldData: Record<string, unknown> = {}

          const setField = (
            framerFieldName: string,
            type: "string" | "image" | "link" | "boolean",
            value: unknown
          ) => {
            const field = fieldByName.get(framerFieldName.toLowerCase())

           if (!field) return
if (type !== "boolean" && !hasValue(value)) return

if (
  type === "image" &&
  !/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(value as string)
) {
  return
}

fieldData[field.id] = { type, value }ield.id] = { type, value }
          }

          setField("Brand Name", "string", brand.name)
          setField("Category", "string", brand.category)
          setField("Description", "string", brand.description)
          setField("Logo", "image", brand.logo_url)
          setField("Product 1", "image", brand.image_1_url)
          setField("Product 2", "image", brand.image_2_url)
          setField("Product 3", "image", brand.image_3_url)
          setField("Website URL", "link", brand.website)
          setField("Instagram", "link", brand.instagram)
          setField("Country", "string", brand.country)
          setField("Featured", "boolean", false)

          synced.push(slug)
          if (existingItem) updated.push(slug)
          else added.push(slug)

          return {
            ...(existingItem ? { id: existingItem.id } : {}),
            slug,
            fieldData,
          }
        })

      await collection.addItems(itemsToSync)

      return Response.json({
        success: true,
        message: "Supabase brands zijn naar Framer gesynchroniseerd.",
        added,
        updated,
        unchangedExistingItems: existingItems
          .filter((item: any) => !synced.includes(item.slug))
          .map((item: any) => item.slug),
        note:
          "De items zijn toegevoegd of bijgewerkt, maar nog niet automatisch gepubliceerd.",
      })
    } catch (error) {
      console.error("Brand sync failed:", error)

      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    } finally {
      await framer?.disconnect()
    }
  },
}
