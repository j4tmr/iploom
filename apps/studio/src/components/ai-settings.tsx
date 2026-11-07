import { useEffect, useRef, useState } from "react";
import type { AiConfigInfo } from "../core/ai.ts";
import type { UiLocale } from "../core/types.ts";
import type { Translate } from "../i18n.ts";
import { bridge } from "../platform.ts";
import { Button, Field, TextInput } from "./ui.tsx";

export function AiSettings({
  locale,
  t,
  info,
  onConfigured,
}: {
  locale: UiLocale;
  t: Translate;
  info: AiConfigInfo | null;
  onConfigured: (info: AiConfigInfo) => void;
}) {
  const en = locale === "en";
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
  return (
    <section className="settings-panel">
      <h2>{t("modelSettings")}</h2>
      <p>
        {en
          ? "Chat Completions compatible. Configuration and key stay in desktop memory for this session only; re-enter after restart. Sending requires an explicit run action. Local servers may leave the key blank."
          : "兼容 Chat Completions。配置与密钥仅保存在本次桌面会话内存，重启后需重新填写；只有点击执行才发送内容。本地服务可不填密钥。"}
      </p>
      {info?.configured ? (
        <div className="model-status">
          <span className="model-status-dot" />
          <div>
            <strong>{t("modelConfiguredStatus")}</strong>
            <small>
              {t("modelEndpoint")}: <code>{info.endpoint}</code>
            </small>
            <small>
              {t("modelIdentifier")}: <code>{info.model}</code>
            </small>
          </div>
        </div>
      ) : (
        <div className="model-status model-status-missing">
          <span className="model-status-dot" />
          <div>
            <strong>{t("modelSetupTitle")}</strong>
            <small>{t("modelSetupBody")}</small>
          </div>
        </div>
      )}
      <Field
        label={en ? "API base URL (including /v1)" : "API 基础地址（含 /v1）"}
      >
        <TextInput
          value={endpoint}
          placeholder="https://your-provider.example/v1"
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </Field>
      <Field label={en ? "Model ID" : "模型 ID"}>
        <TextInput value={model} onChange={(e) => setModel(e.target.value)} />
      </Field>
      <Field label="API key">
        <TextInput
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
      <Button
        onClick={async () => {
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
        }}
      >
        {en ? "Configure session" : "配置本次会话"}
      </Button>
      <p role="status">{message}</p>
    </section>
  );
}
