import { connect } from "framer-api"

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json(
        { success: false, error: "Only POST requests are allowed" },
        { status: 405 }
      )
    }

    let framer: Awaited<ReturnType<typeof connect>> | undefined

    try {
      const projectUrl = process.env.FRAMER_PROJECT_URL
      const apiKey = process.env.FRAMER_API_KEY

      if (!projectUrl) throw new Error("FRAMER_PROJECT_URL ontbreekt")
      if (!apiKey) throw new Error("FRAMER_API_KEY ontbreekt")

      framer = await connect(projectUrl, apiKey)

      const project = await framer.getProjectInfo()
      const collections = await framer.getCollections()

      return Response.json({
        success: true,
        project: {
          id: project.id,
          name: project.name,
        },
        collections: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
        })),
      })
    } catch (error) {
      console.error("Framer test failed:", error)

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
