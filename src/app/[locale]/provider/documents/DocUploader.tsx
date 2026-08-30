const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function DocUploader({ providerId, kinds, labels }: {
  providerId: string;
  kinds: { value: string; label: string }[];
  labels: { kind: string; expires: string; upload: string; uploading: string };
}) {
  return (
    <form action="/api/provider/documents" method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="provider_id" value={providerId} />
      <label className="text-sm">{labels.kind}
        <select name="kind" className="input mt-1">
          {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label className="text-sm">{labels.expires}
        <input name="expires" type="date" className="input mt-1" />
      </label>
      <label className="text-sm sm:col-span-2">{labels.upload}
        <input name="document" type="file" accept={ACCEPTED.join(",")} required className="input mt-1 py-2" />
      </label>
      <button className="btn-primary sm:col-span-4 sm:justify-self-start" type="submit">{labels.upload}</button>
    </form>
  );
}
