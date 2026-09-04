"use client";

import Cropper, { type Area } from "react-easy-crop";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetCrop, saveCrop } from "./actions";

type Props = {
  imagePath: string;
  reportId: string;
  brandId: string;
  evidenceId: string;
  onClose: () => void;
};

export default function CropDialog({ imagePath, reportId, brandId, evidenceId, onClose }: Props) {
  const router = useRouter();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const reset = () => startTransition(async () => {
    await resetCrop(reportId, brandId, evidenceId);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    router.refresh();
  });

  const save = () => {
    if (!area) {
      setError("Move or zoom the image to define the crop first.");
      return;
    }
    startTransition(async () => {
      await saveCrop(reportId, brandId, evidenceId, area);
      router.refresh();
      onClose();
    });
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-4" role="dialog" aria-modal="true" aria-label="Crop evidence image">
    <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div><h2 className="font-semibold text-slate-950">Crop evidence image</h2><p className="text-sm text-slate-500">This is non-destructive; the original upload remains unchanged.</p></div>
        <button type="button" className="button button-secondary" onClick={onClose}>Close</button>
      </div>
      <div className="relative h-[55vh] min-h-80 bg-slate-900">
        <Cropper image={imagePath} crop={crop} zoom={zoom} aspect={16 / 10} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} />
      </div>
      <div className="p-5">
        <label className="flex items-center gap-3 text-sm font-medium text-slate-700">Zoom
          <input className="w-full" type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => setZoom(Number(event.target.value))} />
        </label>
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className="button button-secondary" disabled={pending} onClick={reset}>Reset crop</button><button type="button" className="button" disabled={pending} onClick={save}>Save crop</button></div>
      </div>
    </div>
  </div>;
}
