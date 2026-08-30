import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <p className="text-6xl font-extrabold text-lagoon-200">404</p>
      <h1 className="mt-4 text-xl font-bold text-lagoon-950">Page not found / Az oldal nem található</h1>
      <Link href="/" className="btn-primary mt-6 inline-flex">Travendiq</Link>
    </div>
  );
}
