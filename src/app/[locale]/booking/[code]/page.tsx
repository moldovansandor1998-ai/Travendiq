import { notFound } from "next/navigation";
import Image from "next/image";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createServiceClient } from "@/lib/supabase/server";
import { signVoucher, voucherQrDataUrl } from "@/lib/qr";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/utils";
import { getBookingWithAccess } from "@/lib/booking/access";
import type { BookingStatus } from "@/lib/booking/status";
import { BookingActions } from "./BookingActions";

export const dynamic = "force-dynamic";
type Booking = { id:string; code:string; status:BookingStatus; date:string; start_time:string; adults:number; children:number; infants:number; grand_total:number; currency:string; listing_id:string; customer_locale:string; user_id:string|null; cancel_reason:string|null; lead_name:string|null; lead_email:string|null; lead_phone:string|null; hotel_name:string|null; pickup_address:string|null; pickup_notes:string|null; special_requests:string|null; paid_at:string|null; confirmed_at:string|null; created_at:string };

export default async function BookingPage(
  props: { params: Promise<{locale:Locale;code:string}>; searchParams: Promise<{paid?:string;token?:string}> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const {locale,code}=params;const t=getDictionary(locale);
  const access=await getBookingWithAccess({code},searchParams.token??null);
  if(!access.ok){if(access.reason==="not_found")notFound();return <div className="container-page max-w-xl py-16 text-center"><h1 className="text-xl font-bold">403</h1><p className="mt-2 text-lagoon-600">{t.booking.noAccess}</p></div>}
  const b=access.booking as Booking;const sb=createServiceClient();
  const {data:listing}=await sb.from("listings").select(`slug,duration_minutes,meeting_point,has_transfer,free_cancellation,cancel_full_hours,translations:listing_translations(locale,title,description,includes,excludes,bring_with,important_info),media:listing_media(kind,url,sort_order),zones:listing_transfer_zones(zone_name,pickup_from,pickup_to,pickup_fee,note),provider:providers(display_name,contact_name,contact_phone,contact_email)`).eq("id",b.listing_id).single();
  const trs=(listing?.translations??[]) as any[];const tr=trs.find(x=>x.locale===locale)??trs.find(x=>x.locale==="en")??trs[0];
  const media=[...((listing?.media??[]) as any[])].sort((a,z)=>a.sort_order-z.sort_order);const hero=media.find(m=>m.kind==="image")?.url;
  const provider=listing?.provider as any;const token=access.via==="owner"?null:(searchParams.token??null);const tokenQuery=token?`?token=${encodeURIComponent(token)}`:"";
  const voucherUrl=`/api/voucher/${b.code}${token?`?token=${encodeURIComponent(token)}&format=pdf`:"?format=pdf"}`;
  const participants=[b.adults?`${b.adults} felnőtt`:"",b.children?`${b.children} gyermek`:"",b.infants?`${b.infants} csecsemő`:""].filter(Boolean).join(", ");
  const startsAt=new Date(`${b.date}T${String(b.start_time).slice(0,8)}`);const completed=["completed","attended"].includes(b.status)||startsAt.getTime()<Date.now();
  const dateLabel=new Intl.DateTimeFormat(locale,{year:"numeric",month:"long",day:"numeric",weekday:"short"}).format(startsAt);const duration=formatDuration(listing?.duration_minutes??null,locale);
  const pickup=b.pickup_address||b.hotel_name||listing?.meeting_point||"—";const mapUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickup)}`;
  const calendarUrl=googleCalendarUrl(tr?.title||"Travendiq program",startsAt,listing?.duration_minutes??60,pickup,`${b.code} · ${provider?.display_name||"Travendiq"}`);
  const cancelDeadline=new Date(startsAt.getTime()-(listing?.cancel_full_hours??24)*3600000);const canShowContact=!["pending_payment","expired"].includes(b.status)&&provider;
  const whatsapp=provider?.contact_phone?.replace(/^00/ ,"+").replace(/[^0-9+]/g,"")??"";let qr:string|null=null;
  if(["confirmed","attended","pending_confirmation","completed"].includes(b.status)&&process.env.VOUCHER_SIGNING_SECRET)qr=await voucherQrDataUrl(signVoucher({code:b.code,exp:b.date}));

  return <main className="min-h-screen bg-[#f2f4f7] pb-16">
    <section className="relative mx-auto h-[360px] max-w-4xl overflow-hidden bg-lagoon-950 sm:rounded-b-[2rem]">
      {hero?<Image src={hero} alt={tr?.title||"Program"} fill priority sizes="(max-width: 896px) 100vw, 896px" className="object-cover opacity-80"/>:<div className="h-full bg-gradient-to-br from-lagoon-800 to-lagoon-950"/>}<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/25"/>
      <a href={`/${locale}/account`} className="absolute left-5 top-5 grid h-12 w-12 place-items-center rounded-full bg-white text-2xl text-lagoon-950 shadow">←</a><a href="mailto:support@travendiq.com" className="absolute right-5 top-5 grid h-12 w-12 place-items-center rounded-full bg-white text-xl font-bold text-lagoon-950 shadow">?</a>
      <div className="absolute bottom-7 left-6 right-6 text-white"><p className="text-sm font-semibold uppercase tracking-wider opacity-90">{completed?"A program befejeződött":"Közelgő program"}</p><h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{tr?.title||t.booking.title}</h1></div>
    </section>
    <div className="container-page -mt-3 max-w-3xl space-y-5 px-3 sm:px-5">
      {searchParams.paid==="1"&&<div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-medium text-emerald-900">{t.checkout.success}</div>}
      <Card><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold text-lagoon-950">Foglalási adatok</h2><p className="mt-1 text-lagoon-600">{provider?.display_name||"Travendiq szolgáltató"}</p></div><StatusBadge status={b.status} label={(t.booking.status as Record<string,string>)[b.status]??b.status}/></div>
        <div className="mt-6 space-y-4"><Detail icon="▣" title={dateLabel}/><Detail icon="◷" title={`${String(b.start_time).slice(0,5)}${listing?.has_transfer?" · transzfer/felvétel":""}`} text="Tartsd elérhetően a telefonodat az esetleges változások miatt."/><Detail icon="◴" title={`Időtartam: ${duration}`}/><Detail icon="♙" title={participants}/><Detail icon="⌁" title={`Foglalási kód: ${b.code}`} text={b.lead_name||undefined}/></div>
        <div className="mt-6 divide-y divide-lagoon-100 border-t border-lagoon-100">{qr&&<ActionRow href={voucherUrl} label="Jegy / voucher megjelenítése"/>}<ActionRow href={calendarUrl} label="Hozzáadás a naptárhoz" external/><ActionRow href={`/${locale}/listing/${listing?.slug}`} label="A program nyilvános adatlapja"/><ActionRow href={`/${locale}/listing/${listing?.slug}`} label="Újrafoglalás"/></div>
      </Card>
      <Card><h2 className="text-2xl font-extrabold text-lagoon-950">A találkozás és transzfer részletei</h2><div className="mt-5 space-y-5"><Detail icon="⌖" title="Felvételi / találkozási cím" text={pickup}/><Detail icon="◷" title={`Időpont: ${String(b.start_time).slice(0,5)}`} text={b.pickup_notes||"Kérjük, legalább 10 perccel korábban várakozz a megadott helyen."}/>{tr?.important_info&&<Detail icon="ⓘ" title="Fontos információ" text={tr.important_info}/>}</div>
        <a href={mapUrl} target="_blank" rel="noopener" className="mt-6 flex items-center justify-between rounded-xl border border-lagoon-200 p-4 font-bold text-lagoon-950 hover:bg-lagoon-50">Találkozási pont megtekintése a térképen <span>›</span></a>
        {((listing?.zones??[]) as any[]).length>0&&<div className="mt-5 rounded-xl bg-lagoon-50 p-4"><h3 className="font-bold">Transzferzónák</h3>{((listing?.zones??[]) as any[]).map((z,i)=><p key={i} className="mt-2 text-sm text-lagoon-700"><b>{z.zone_name}</b>: {z.pickup_from||"—"} → {z.pickup_to||"—"}{z.note?` · ${z.note}`:""}</p>)}</div>}
      </Card>
      {(tr?.includes||tr?.excludes||tr?.bring_with)&&<Card><h2 className="text-2xl font-extrabold text-lagoon-950">Programinformációk</h2><div className="mt-5 space-y-5">{tr.includes&&<TextSection title="Amit tartalmaz" text={tr.includes}/>} {tr.excludes&&<TextSection title="Amit nem tartalmaz" text={tr.excludes}/>} {tr.bring_with&&<TextSection title="Indulás előtti tudnivalók" text={tr.bring_with}/>}</div></Card>}
      <Card><h2 className="text-2xl font-extrabold text-lagoon-950">Az általad megadott információk</h2><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Info label="Kapcsolattartó" value={b.lead_name}/><Info label="Telefon" value={b.lead_phone}/><Info label="Email" value={b.lead_email}/><Info label="Szálloda" value={b.hotel_name}/><Info label="Felvételi cím" value={b.pickup_address}/><Info label="Különleges kérés" value={b.special_requests}/></dl></Card>
      {canShowContact&&<Card><h2 className="text-2xl font-extrabold text-lagoon-950">Kapcsolat a programszervezővel</h2><p className="mt-2 text-lagoon-700">{provider.display_name}{provider.contact_name?` · ${provider.contact_name}`:""}</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{provider.contact_phone&&<a className="btn-secondary text-center" href={`tel:${provider.contact_phone}`}>Telefonhívás</a>}{whatsapp.startsWith("+")&&<a className="btn-primary text-center" href={`https://wa.me/${whatsapp.slice(1)}`} target="_blank" rel="noopener">WhatsApp</a>}{provider.contact_email&&<a className="btn-secondary text-center" href={`mailto:${provider.contact_email}`}>Email</a>}</div></Card>}
      <Card><h2 className="text-2xl font-extrabold text-lagoon-950">Fizetési információ</h2><p className="mt-5 text-sm text-lagoon-600">Összeg</p><p className="text-3xl font-extrabold text-lagoon-950">{formatMoney(b.grand_total,b.currency,locale)}</p><p className={`mt-2 font-semibold ${b.paid_at?"text-emerald-700":"text-amber-700"}`}>{b.paid_at?`Fizetve: ${new Intl.DateTimeFormat(locale).format(new Date(b.paid_at))}`:"Fizetésre vár"}</p>{b.paid_at&&<a href={voucherUrl} target="_blank" rel="noopener" className="btn-secondary mt-5 flex justify-center">Fizetési igazolás és voucher</a>}</Card>
      <Card><h2 className="text-2xl font-extrabold text-lagoon-950">Valami közbejött?</h2><p className="mt-3 text-lagoon-700">{listing?.free_cancellation?`Az ingyenes lemondás határideje: ${new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(cancelDeadline)}.`:"A programra a szolgáltató lemondási feltételei vonatkoznak."}</p>{(access.via==="owner"||access.via==="guest_token")&&<BookingActions bookingId={b.id} status={b.status} locale={locale} token={token} freeCancelHours={listing?.free_cancellation?listing.cancel_full_hours:null} labels={{cancel:t.booking.cancel,reschedule:t.booking.reschedule,cancelled:t.booking.cancelled,confirmCancel:t.booking.confirmCancel,review:t.booking.writeReview,freeCancelUntil:t.booking.freeCancelUntil}}/>}</Card>
      <Card><h2 className="text-2xl font-extrabold text-lagoon-950">Kell segítség?</h2><p className="mt-3 text-lagoon-700">Ha kérdésed van, az ügyfélszolgálatnak add meg ezt a foglalási kódot: <b>{b.code}</b>.</p><div className="mt-5 divide-y border-t"><ActionRow href="mailto:support@travendiq.com" label="Kapcsolat az ügyfélszolgálattal"/><ActionRow href={`/${locale}/messages${tokenQuery}`} label="Üzenetek megnyitása"/></div></Card>
    </div>
  </main>
}

function Card({children}:{children:React.ReactNode}){return <section className="rounded-[1.5rem] bg-white p-6 shadow-sm sm:p-8">{children}</section>}
function Detail({icon,title,text}:{icon:string;title:string;text?:string}){return <div className="flex gap-4"><span className="w-7 shrink-0 text-center text-2xl text-lagoon-900">{icon}</span><div><p className="font-bold text-lagoon-950">{title}</p>{text&&<p className="mt-1 whitespace-pre-line text-sm leading-6 text-lagoon-600">{text}</p>}</div></div>}
function ActionRow({href,label,external}:{href:string;label:string;external?:boolean}){return <a href={href} target={external?"_blank":undefined} rel={external?"noopener":undefined} className="flex items-center justify-between py-4 font-bold text-lagoon-950 hover:text-lagoon-700"><span>{label}</span><span className="text-2xl">›</span></a>}
function TextSection({title,text}:{title:string;text:string}){return <div><h3 className="text-lg font-bold text-lagoon-950">{title}</h3><p className="mt-2 whitespace-pre-line leading-7 text-lagoon-700">{text}</p></div>}
function Info({label,value}:{label:string;value:string|null}){return value?<div><dt className="text-sm font-semibold text-lagoon-500">{label}</dt><dd className="mt-1 whitespace-pre-line text-lagoon-900">{value}</dd></div>:null}
function formatDuration(minutes:number|null,locale:string){if(!minutes)return "—";const h=Math.floor(minutes/60),m=minutes%60;if(locale==="hu")return [h?`${h} óra`:"",m?`${m} perc`:""].filter(Boolean).join(" ");return [h?`${h} h`:"",m?`${m} min`:""].filter(Boolean).join(" ")}
function googleCalendarUrl(title:string,start:Date,duration:number,location:string,details:string){const fmt=(d:Date)=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");const end=new Date(start.getTime()+duration*60000);return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&location=${encodeURIComponent(location)}&details=${encodeURIComponent(details)}`}
