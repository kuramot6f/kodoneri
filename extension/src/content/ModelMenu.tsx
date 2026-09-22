import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const [view, setView] = useState<ModelsView | null>(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState("");
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

  const model = view?.settings && view.models.find(({ key }) => key === view.settings!.model);
  const providers = Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[];

  const copyDiagnostics = async () => {
    try {
      const contents = await browser.runtime.sendMessage({ type: "debug_export" } satisfies RuntimeMessage) as string;
      await navigator.clipboard.writeText(contents);
      setDiagnosticStatus(t`Diagnostics copied`);
    } catch {
      setDiagnosticStatus(t`Could not copy diagnostics`);
    }
  };

  const clearDiagnostics = async () => {
    try {
      await browser.runtime.sendMessage({ type: "debug_clear" } satisfies RuntimeMessage);
      setDiagnosticStatus(t`Diagnostics cleared`);
    } catch {
      setDiagnosticStatus(t`Could not clear diagnostics`);
    }
  };

  return (
    <div className="model-menu" ref={menuRef} role="dialog" aria-label={t`Model and reasoning effort`}>
      {!view ? null : !view.settings || !model ? (
        <p className="model-menu-empty"><Trans>No API key is configured. Configure one in the chatext app.</Trans></p>
      ) : (
        <>
          <label className="model-menu-row">
            <span><Trans>Model</Trans></span>
            <select
              value={model.key}
              onChange={(event) => {
                const next = view.models.find(({ key }) => key === event.target.value)!;
                save({ model: next.key, effort: clampEffort(next, view.settings!.effort) });
              }}
            >
              {providers.map((provider) => {
                const models = view.models.filter((candidate) => candidate.provider === provider);
                return models.length === 0 ? null : (
                  <optgroup label={PROVIDERS[provider]} key={provider}>
                    {models.map(({ key, label }) => <option value={key} key={key}>{label}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
          {model.efforts.length > 0 && (
            <label className="model-menu-row">
              <span><Trans>Reasoning effort</Trans></span>
              <input
                type="range"
                min={0}
                max={model.efforts.length - 1}
                step={1}
                value={model.efforts.indexOf(view.settings.effort)}
                onChange={(event) => save({ model: model.key, effort: model.efforts[Number(event.target.value)]! })}
              />
              <output>{EFFORT_LABELS[view.settings.effort]}</output>
            </label>
          )}
        </>
      )}
      <div className="diagnostic-actions">
        <button type="button" onClick={() => void copyDiagnostics()}><Trans>Copy diagnostics</Trans></button>
        <button type="button" onClick={() => void clearDiagnostics()}><Trans>Clear</Trans></button>
      </div>
      {diagnosticStatus && <p className="diagnostic-status" role="status">{diagnosticStatus}</p>}
    </div>
  );
}
