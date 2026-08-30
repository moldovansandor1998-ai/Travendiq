import { isLocale, type Locale } from "@/lib/i18n/locales";

/**
 * Voucher/PDF feliratok mind a 9 locale-ra. A booking.customer_locale a
 * mérvadó; ismeretlen/hiányzó érték esetén angol fallback.
 */
export interface VoucherLabels {
  voucherTitle: string;
  experience: string;
  date: string;
  guests: string;
  leadGuest: string;
  meetingPoint: string;
  provider: string;
  adults: string;
  children: string;
  infants: string;
  showAtCheckin: string;
  qrAlt: string;
}

const en: VoucherLabels = {
  voucherTitle: "Booking voucher",
  experience: "Experience",
  date: "Date",
  guests: "Guests",
  leadGuest: "Lead guest",
  meetingPoint: "Meeting point",
  provider: "Provider",
  adults: "adults",
  children: "children",
  infants: "infants",
  showAtCheckin: "Show this voucher at check-in",
  qrAlt: "Voucher QR code",
};

const dicts: Record<Locale, VoucherLabels> = {
  en,
  hu: {
    voucherTitle: "Foglalási voucher",
    experience: "Élmény",
    date: "Dátum",
    guests: "Vendégek",
    leadGuest: "Kapcsolattartó vendég",
    meetingPoint: "Találkozási pont",
    provider: "Szolgáltató",
    adults: "felnőtt",
    children: "gyermek",
    infants: "csecsemő",
    showAtCheckin: "Mutasd fel ezt a vouchert a belépéskor",
    qrAlt: "Voucher QR-kód",
  },
  de: {
    voucherTitle: "Buchungsgutschein",
    experience: "Erlebnis",
    date: "Datum",
    guests: "Gäste",
    leadGuest: "Hauptgast",
    meetingPoint: "Treffpunkt",
    provider: "Anbieter",
    adults: "Erwachsene",
    children: "Kinder",
    infants: "Kleinkinder",
    showAtCheckin: "Zeigen Sie diesen Gutschein beim Check-in vor",
    qrAlt: "Gutschein-QR-Code",
  },
  fr: {
    voucherTitle: "Bon de réservation",
    experience: "Expérience",
    date: "Date",
    guests: "Voyageurs",
    leadGuest: "Voyageur principal",
    meetingPoint: "Point de rendez-vous",
    provider: "Prestataire",
    adults: "adultes",
    children: "enfants",
    infants: "bébés",
    showAtCheckin: "Présentez ce bon lors de l'enregistrement",
    qrAlt: "Code QR du bon",
  },
  es: {
    voucherTitle: "Bono de reserva",
    experience: "Experiencia",
    date: "Fecha",
    guests: "Huéspedes",
    leadGuest: "Huésped principal",
    meetingPoint: "Punto de encuentro",
    provider: "Proveedor",
    adults: "adultos",
    children: "niños",
    infants: "bebés",
    showAtCheckin: "Muestra este bono al hacer el check-in",
    qrAlt: "Código QR del bono",
  },
  it: {
    voucherTitle: "Voucher di prenotazione",
    experience: "Esperienza",
    date: "Data",
    guests: "Ospiti",
    leadGuest: "Ospite principale",
    meetingPoint: "Punto di incontro",
    provider: "Fornitore",
    adults: "adulti",
    children: "bambini",
    infants: "neonati",
    showAtCheckin: "Mostra questo voucher al check-in",
    qrAlt: "Codice QR del voucher",
  },
  ro: {
    voucherTitle: "Voucher de rezervare",
    experience: "Experiență",
    date: "Dată",
    guests: "Oaspeți",
    leadGuest: "Oaspete principal",
    meetingPoint: "Punct de întâlnire",
    provider: "Furnizor",
    adults: "adulți",
    children: "copii",
    infants: "sugari",
    showAtCheckin: "Prezentați acest voucher la check-in",
    qrAlt: "Cod QR voucher",
  },
  pl: {
    voucherTitle: "Voucher rezerwacji",
    experience: "Atrakcja",
    date: "Data",
    guests: "Goście",
    leadGuest: "Gość główny",
    meetingPoint: "Miejsce spotkania",
    provider: "Usługodawca",
    adults: "dorośli",
    children: "dzieci",
    infants: "niemowlęta",
    showAtCheckin: "Pokaż ten voucher podczas zameldowania",
    qrAlt: "Kod QR vouchera",
  },
  ar: {
    voucherTitle: "قسيمة الحجز",
    experience: "التجربة",
    date: "التاريخ",
    guests: "الضيوف",
    leadGuest: "الضيف الرئيسي",
    meetingPoint: "نقطة الالتقاء",
    provider: "المزود",
    adults: "بالغون",
    children: "أطفال",
    infants: "رضّع",
    showAtCheckin: "أظهر هذه القسيمة عند تسجيل الوصول",
    qrAlt: "رمز QR للقسيمة",
  },
};

export function voucherLabels(locale: string | null | undefined): { labels: VoucherLabels; locale: Locale; rtl: boolean } {
  const l: Locale = locale && isLocale(locale) ? locale : "en";
  return { labels: dicts[l], locale: l, rtl: l === "ar" };
}
