import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proxy Harvester",
  description: "Tự động thu thập, kiểm tra và giám sát proxy miễn phí",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0f172a", color: "#e2e8f0" }}>
        {children}
      </body>
    </html>
  );
}
