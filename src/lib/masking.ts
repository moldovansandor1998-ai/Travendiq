/**
 * Elérhetőség-maszkolás a belső üzenetrendszerhez:
 * emailcímek, telefonszámok és URL-ek maszkolása a személyes adatok védelmére.
 */
export function maskContactInfo(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(\+?\d[\d\s()./-]{6,}\d)/g, "[phone]")
    .replace(/(https?:\/\/|www\.)[^\s]+/gi, "[link]");
}

export function containsContactInfo(text: string): boolean {
  return (
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) ||
    /(\+?\d[\d\s()./-]{6,}\d)/.test(text) ||
    /(https?:\/\/|www\.)/i.test(text)
  );
}
