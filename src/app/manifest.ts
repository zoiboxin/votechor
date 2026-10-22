import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VoteChor: The Great Parliament Run",
    short_name: "VoteChor",
    description:
      "Free 3D multiplayer satirical protest game — dodge patrols, snatch back the stolen vote tokens and topple The Great Vote Collector. Play instantly in your browser.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: "#f5efdc",
    theme_color: "#f2a541",
    lang: "en",
    dir: "ltr",
    categories: ["games", "entertainment", "action games"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
