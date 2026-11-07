import { useEffect, useRef, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Button, Field, TextInput } from "./ui.tsx";

export function AiSettings({ t, info, onConfigured }: {
  t: Translate;
  info: AiConfigInfo | null;
  onConfigured: (info: AiConfigInfo) => void;
}) {
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !info) return;
    hydrated.current = true;
    setEndpoint(info.endpoint);
    setModel(info.model);
  }, [info]);
  return <section className="settings-panel">
    <h2>{t("modelSettings")}</h2>
    <p>{t("aiSettingsLead")}</p>
    {info?.configured ? <div className="model-status">
      <span className="model-status-dot" />
      <div>
        <strong>{t("modelConfiguredStatus")}</strong>
        <small>{t("modelEndpoint")}: <code>{info.endpoint}</code></small>
        <small>{t("modelIdentifier")}: <code>{info.model}</code></small>
      </div>
    </div> : <div className="model-status model-status-missing">
      <span className="model-status-dot" />
      <div>
        <strong>{t("modelSetupTitle")}</strong>
        <small>{t("modelSetupBody")}</small>
      </div>
    </div>}
    <Field label={t("aiBaseUrl")}><TextInput value={endpoint} placeholder="https://your-provider.example/v1" onChange={(e) => setEndpoint(e.target.value)} /></Field>
    <Field label={t("aiModelId")}><TextInput value={model} onChange={(e) => setModel(e.target.value)} /></Field>
    <Field label={t("aiApiKey")}><TextInput type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></Field>
    <Button onClick={async () => {
      try {
        const next = await bridge.configureAi({ endpoint, model, apiKey });
        setEndpoint(next.endpoint);
        setModel(next.model);
        setApiKey("");
        setMessage(t("modelConfiguredStatus"));
        onConfigured(next);
      } catch (error) {
        setMessage(String(error));
      }
    }}>{t("aiConfigureSession")}</Button>
    <p role="status">{message}</p>
  </section>;
}
