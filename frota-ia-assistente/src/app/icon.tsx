import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Logo oficial (public/frota-ia-logo.jpg) embutida como data URI — ImageResponse
// roda fora do runtime normal do Next e não resolve caminho relativo de /public.
const logoDataUri = `data:image/jpeg;base64,${readFileSync(join(process.cwd(), "public/frota-ia-logo.jpg")).toString("base64")}`;

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) exige <img>, não aceita next/image */}
        <img src={logoDataUri} width={32} height={32} style={{ objectFit: "cover" }} alt="" />
      </div>
    ),
    { ...size }
  );
}
