Use the native AI SDK v7 Files API for DeepSeek. Do not implement our own DeepSeek file adapter unless we hit an actual unsupported case.

Current `@ai-sdk/deepseek` supports `deepSeek.files()` and AI SDK's `uploadFile()`. Upload the image once, store only the returned `providerReference` / DeepSeek `file_id` in the conversation data, and discard the local/base64 image after upload.

Conceptually:

```ts
const uploaded = await uploadFile({
  api: deepSeek.files(),
  data: imageBytes,
  mediaType: "image/png",
  filename: "image.png",
});
```

The returned value contains a provider reference equivalent to:

```ts
{ deepseek: "file-api-..." }
```

For later model calls, use that reference as a normal AI SDK file part:

```ts
{
  type: "file",
  mediaType: "image/png",
  data: uploaded.providerReference,
}
```

The DeepSeek provider currently resolves this provider reference and sends the native DeepSeek content block:

```ts
{
  type: "file",
  file_id: "file-api-..."
}
```

Therefore, subsequent turns do not need the original bytes/base64 and should not re-upload the image. Persist the provider reference alongside the message/history and reuse it.

Important implementation details:

* Use `@ai-sdk/deepseek`, not a generic OpenAI-compatible provider, for this path.
* DeepSeek Files currently supports image uploads: JPEG, PNG, GIF, and WebP.
* Maximum uploaded file size is 64 MiB.
* `expiresAfter` is supported from 1 hour to 30 days.
* If no expiry is specified, DeepSeek documents the file as persistent.
* The DeepSeek provider already sends `purpose=user_data` and the correct `expires_after[anchor]` / `expires_after[seconds]` multipart fields.
* Do not store base64 in chat history. Store `providerReference`, `mediaType`, and optionally filename/metadata.
* When serializing UI messages, preserve `providerReference`; AI SDK v7 explicitly supports provider references on file parts.
* A provider reference is provider-specific. A DeepSeek-uploaded file cannot automatically be reused with another provider; that provider would need its own upload/reference.

For this application, the intended lifecycle should be:

`user selects/captures image -> upload once to DeepSeek -> save providerReference -> release local image bytes -> reuse providerReference in every later turn`

Do not convert the stored reference back into base64 on subsequent requests.

For images returned by browser tools, append the messages once in this exact order:

`assistant tool call -> tool result -> user(file providerReference)`

The user file message becomes part of the canonical history. Never rebuild prior history or use `prepareStep` to insert the file into an earlier position; later calls must reuse the append-only history verbatim so DeepSeek's prefix KV cache remains valid.
