import Image from "next/image";
import Link from "next/link";

import "./globals.css";

export const metadata = {
  title: "Competitor Ads Report",
  description: "Competitor advertising reporting",
};

const navigation = [
  { href: "/", label: "Dashboard" },
  { href: "/reports", label: "Monthly reports" },
  { href: "/brands", label: "Brands" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
          <aside className="border-b border-slate-200 bg-white p-6 text-slate-700 md:border-r md:border-b-0">
            <Link href="/" className="inline-block">
              <Image
                src="/emil-frey-logo.webp"
                alt="Emil Frey"
                width={160}
                height={167}
                priority
                className="h-auto w-28"
              />
              <span className="mt-4 block text-lg font-bold leading-tight tracking-tight text-[#0b2440]">
                Competitor
                <br />
                <span className="text-[#0b62a9]">Ads Report</span>
              </span>
            </Link>
            <nav className="mt-10 flex gap-2 md:flex-col">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-blue-50 hover:text-blue-800"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <form action="/logout" method="post" className="mt-10">
              <button className="text-sm text-slate-500 transition-colors hover:text-blue-800">Sign out</button>
            </form>
          </aside>
          <main className="min-w-0 p-5 md:p-9">{children}</main>
        </div>
      </body>
    </html>
  );
}
