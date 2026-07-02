import { mediaSrc } from "./api"
import { WrenchIcon } from "./icons"
import StopReactions from "./StopReactions"
import { C, dateLabelNL, FONT_MONO, GALLERY_ROTS } from "./theme"
import type { MediaItem, Stop } from "./types"
import { weatherLabel } from "./weather"

function GalleryTile({ item, index }: { item: MediaItem; index: number }) {
  const src = mediaSrc(item.url)
  const rot = GALLERY_ROTS[index % GALLERY_ROTS.length]
  const shell: React.CSSProperties = {
    scrollSnapAlign: "center",
    flex: "none",
    width: 280,
    height: 220,
    borderRadius: 8,
    border: "5px solid #fff",
    boxShadow: "0 3px 8px rgba(80,60,30,.3)",
    position: "relative",
    overflow: "hidden",
    transform: `rotate(${rot})`,
  }
  return (
    <div style={shell}>
      {src && item.kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: caption sits below the tile
        <video
          src={src}
          controls
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : src ? (
        <img
          src={src}
          alt={item.cap || ""}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: `linear-gradient(150deg,rgba(255,255,255,.25),rgba(0,0,0,.32)),${item.tone || "#c9a24e"}`,
          }}
        />
      )}
      {item.kind === "video" && !src && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(0,0,0,.4)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            ▶
          </div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          left: 8,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,.6)",
        }}
      >
        {item.cap}
      </div>
    </div>
  )
}

export default function StopSheet({
  cur,
  canEdit,
  onClose,
  onEdit,
}: {
  cur: Stop
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
}) {
  const kmText = cur.km != null ? `${cur.km} km` : "— km"
  const weatherText = weatherLabel(cur.weather_condition, cur.weather_temp)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        background: C.paperLight,
        overflowY: "auto",
      }}
      className="bb-scroll bb-fadein"
    >
      <div style={{ position: "relative" }}>
        <div
          className="bb-scroll"
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            padding: "14px 14px 6px",
            scrollSnapType: "x mandatory",
          }}
        >
          {cur.media.map((m, i) => (
            <GalleryTile key={`${m.url ?? m.tone}-${i}`} item={m} index={i} />
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Terug"
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            background: C.paperLight,
            color: C.ink,
            fontSize: 18,
            cursor: "pointer",
            boxShadow: "0 2px 5px rgba(0,0,0,.25)",
          }}
        >
          ‹
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Bewerk stop"
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 14px",
              borderRadius: 18,
              border: `1.5px solid ${C.ochre}`,
              background: C.paperLight,
              color: C.ink,
              fontFamily: FONT_MONO,
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "0 2px 5px rgba(0,0,0,.2)",
            }}
          >
            ✎ bewerk
          </button>
        )}
      </div>

      <div style={{ padding: "16px 20px 40px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.ochreDeep,
          }}
        >
          <span>
            {cur.flag} {cur.place}, {cur.country}
          </span>
          {cur.type === "repair" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                color: "#fff",
                background: C.teal,
                padding: "1px 7px",
                borderRadius: 10,
              }}
            >
              <WrenchIcon size={11} color="#fff" />
              REPARATIE
            </span>
          )}
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 29,
            lineHeight: 1.05,
            margin: "5px 0 4px",
          }}
        >
          {cur.title}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.sepia,
            display: "flex",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <span>{dateLabelNL(cur.date)}</span>
          <span>◷ {kmText}</span>
          {weatherText && <span>{weatherText}</span>}
        </div>
        <div
          style={{
            fontSize: 16.5,
            lineHeight: 1.6,
            color: C.inkSoft,
            textWrap: "pretty",
          }}
        >
          {cur.story}
        </div>
        <StopReactions stopId={cur.id} />
        {cur.type === "repair" && (
          <div
            style={{
              marginTop: 18,
              border: `1.5px solid ${C.teal}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: C.teal,
                color: C.cream,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1,
                padding: "7px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <WrenchIcon size={13} color={C.cream} /> LOGBOEK — REPARATIE
            </div>
            <div
              style={{
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: C.ochreDeep,
                  }}
                >
                  STUK:
                </span>
                <div style={{ fontSize: 15 }}>{cur.broke}</div>
              </div>
              <div>
                <span
                  style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.teal }}
                >
                  GEMAAKT:
                </span>
                <div style={{ fontSize: 15 }}>{cur.fixed}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
