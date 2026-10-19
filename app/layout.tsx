import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ЕдаДа — ваш рацион, ваш бюджет",
  description: "Соберите меню по КБЖУ и бюджету из продуктов магазинов Когалыма.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
