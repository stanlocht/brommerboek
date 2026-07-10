// Vintage-styled error screen: motorpech.

import { Link } from "@tanstack/react-router"
import { C, FONT_MONO, FONT_SERIF } from "@/brommerboek/theme"

const ErrorComponent = () => {
  return (
    <div className="bb-app" data-testid="error-component">
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
            fontSize: 40,
            lineHeight: 1.1,
            color: C.ink,
          }}
        >
          Motorpech
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            maxWidth: 280,
          }}
        >
          er ging iets mis — probeer het nog eens.
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

export default ErrorComponent
