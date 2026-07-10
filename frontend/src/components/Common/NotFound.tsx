// Vintage-styled 404: a wrong turn on the road atlas.

import { Link } from "@tanstack/react-router"
import { C, FONT_MONO, FONT_SERIF } from "@/brommerboek/theme"

const NotFound = () => {
  return (
    <div className="bb-app" data-testid="not-found">
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: C.paperLight,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 20,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 3,
            color: C.ochreDeep,
          }}
        >
          BROMMERBOEK
        </div>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1,
            color: C.ink,
          }}
        >
          404
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            maxWidth: 280,
          }}
        >
          verkeerd afgeslagen — deze pagina staat niet op de kaart.
        </div>
        <Link
          to="/"
          style={{
            marginTop: 12,
            padding: "10px 16px",
            border: `1.5px solid ${C.ochre}`,
            borderRadius: 20,
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            textDecoration: "none",
            background: C.paperCard,
            boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
          }}
        >
          ‹ terug naar de kaart
        </Link>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}

export default NotFound
