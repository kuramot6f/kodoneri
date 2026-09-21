import { useEffect, useRef, useState } from "react";
import { PROVIDERS, clampEffort } from "../shared/models";
import type { Effort, ModelSettings } from "../shared/models";
import type { ModelsView, RuntimeMessage } from "../shared/protocol";

const EFFORT_LABELS: Record<Effort, string> = {
  none: "OFF",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};

/** Model and effort picker above the composer. Every change is saved as it is made. */
export function ModelMenu({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<ModelsView | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void browser.runtime.sendMessage({ type: "models" } satisfies RuntimeMessage).then((result: ModelsView) => setView(result));
  }, []);

  useEffect(() => {
    // The anchor holds the toggle button too, so a click on it is left to the button.
    const anchor = menuRef.current!.parentElement!;
    // The panel lives in a closed shadow root, so document listeners never see the anchor in
    // composedPath(); clicks inside the panel are judged from the shadow root, clicks on the page from the host.
    const shadow = anchor.getRootNode() as ShadowRoot;
    const onPanelPointerDown = (event: Event) => {
      if (!event.composedPath().includes(anchor)) onClose();
    };
    const onPagePointerDown = (event: Event) => {
      if (!event.composedPath().includes(shadow.host)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    shadow.addEventListener("pointerdown", onPanelPointerDown, true);
    document.addEventListener("pointerdown", onPagePointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      shadow.removeEventListener("pointerdown", onPanelPointerDown, true);
      document.removeEventListener("pointerdown", onPagePointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const save = (settings: ModelSettings) => {
    setView((current) => current && { ...current, settings });
    void browser.runtime.sendMessage({ type: "settings", settings } satisfies RuntimeMessage);
  };

  const model = view?.settings && view.models.find(({ id }) => id === view.settings!.model);
  const providers = Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[];

  return (
    <div className="model-menu" ref={menuRef} role="dialog" aria-label="モデルと思考量">
      {!view ? null : !view.settings || !model ? (
        <p className="model-menu-empty">APIキーが設定されていません。chatextアプリで設定してください。</p>
      ) : (
        <>
          <label className="model-menu-row">
            <span>モデル</span>
            <select
              value={model.id}
              onChange={(event) => {
                const next = view.models.find(({ id }) => id === event.target.value)!;
                save({ model: next.id, effort: clampEffort(next, view.settings!.effort) });
              }}
            >
              {providers.map((provider) => {
                const models = view.models.filter((candidate) => candidate.provider === provider);
                return models.length === 0 ? null : (
                  <optgroup label={PROVIDERS[provider]} key={provider}>
                    {models.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
          {model.efforts.length > 0 && (
            <label className="model-menu-row">
              <span>思考量</span>
              <input
                type="range"
                min={0}
                max={model.efforts.length - 1}
                step={1}
                value={model.efforts.indexOf(view.settings.effort)}
                onChange={(event) => save({ model: model.id, effort: model.efforts[Number(event.target.value)]! })}
              />
              <output>{EFFORT_LABELS[view.settings.effort]}</output>
            </label>
          )}
        </>
      )}
    </div>
  );
}
