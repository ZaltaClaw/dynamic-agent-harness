import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Dynamic Agent Harness Studio | Build your governed agent runtime",
  description:
    "A production-minded starter for composing durable, governed, vendor-neutral agent harnesses.",
};

const themeScript = `(function(){try{var t=localStorage.getItem("dah-theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){document.documentElement.classList.add("dark")}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans`}>{children}</body>
    </html>
  );
}
