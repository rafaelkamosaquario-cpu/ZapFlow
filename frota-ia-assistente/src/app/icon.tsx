import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

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
          borderRadius: 9,
          background: "linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <path
            d="M8 20.5 13.5 11l3.2 5.6L19.5 12 24 20.5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="9.5" r="2.2" fill="white" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
