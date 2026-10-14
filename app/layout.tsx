import "./globals.css";

export const metadata = { title: "Kalshi BTC15M Bot" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
