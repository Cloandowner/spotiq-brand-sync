import { connect } from "framer-api"

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

      const brands = await brandsResponse.json()

      framer = await connect(projectUrl, framerApiKey)

      const collections = await framer.getCollections()
      const discoverBrands = collections.find(
        (collection: any) => collection.name === "Discover Brands"
      )

      if (!discoverBrands) {
        throw new Error('Framer collection "Discover Brands" niet gevonden')
      }

      const fields = await discoverBrands.getFields()
      const existingItems = await discoverBrands.getItems()

      return Response.json({
        success: true,
        mode: "read-only-preview",
        message:
          "Alles is alleen uitgelezen; Framer CMS is niet aangepast.",
        supabase: {
          brandCount: brands.length,
          columns: Object.keys(brands[0] ?? {}),
          brands: brands.map((brand: any) => ({
            name: brand.name,
            slug: brand.slug,
          })),
        },
        framer: {
          collection: discoverBrands.name,
          fields: fields.map((field: any) => ({
            id: field.id,
            name: field.name,
            type: field.type,
          })),
          existingItemCount: existingItems.length,
          existingSlugs: existingItems.map((item: any) => item.slug),
        },
      })
    } catch (error) {
      console.error("Brand sync preview failed:", error)

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
