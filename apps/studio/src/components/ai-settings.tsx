import { useEffect, useState } from "react";
import { bridge } from "../platform.ts";
import type { UiLocale } from "../core/types.ts";
import { Button, Field, TextInput } from "./ui.tsx";

export function AiSettings({ locale }: { locale: UiLocale }) {
  const en = locale === "en";
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void bridge.aiConfig().then((value) => { setEndpoint(value.endpoint); setModel(value.model); }).catch(() => undefined); }, []);
  return <section className="settings-panel">
    <h2>{en ? "Model API" : "模型 API"}</h2>
    <p>{en ? "Chat Completions compatible. Configuration and key stay in desktop memory for this session only; re-enter after restart. Sending requires an explicit run action. Local servers may leave the key blank." : "兼容 Chat Completions。配置与密钥仅保存在本次桌面会话内存，重启后需重新填写；只有点击执行才发送内容。本地服务可不填密钥。"}</p>
    <Field label={en ? "API base URL (including /v1)" : "API 基础地址（含 /v1）"}><TextInput value={endpoint} placeholder="https://your-provider.example/v1" onChange={(e) => setEndpoint(e.target.value)} /></Field>
    <Field label={en ? "Model ID" : "模型 ID"}><TextInput value={model} onChange={(e) => setModel(e.target.value)} /></Field>
    <Field label="API key"><TextInput type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></Field>
    <Button onClick={async () => { try { await bridge.configureAi({ endpoint, model, apiKey }); setApiKey(""); setMessage(en ? "Configured for this session." : "本次会话已配置。"); } catch (error) { setMessage(String(error)); } }}>{en ? "Configure session" : "配置本次会话"}</Button>
    <p role="status">{message}</p>
  </section>;
}
