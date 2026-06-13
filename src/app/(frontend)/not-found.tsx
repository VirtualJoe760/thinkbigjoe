import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">404</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-ink-soft">
        That page doesn&apos;t exist. Let&apos;s get you back on track.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Back to home
      </Link>
    </main>
  );
}
