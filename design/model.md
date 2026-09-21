まとめると、reasoning系の設定は **「思考モード」と「effort量」を分けて考える**のが重要です。

| Provider / Model    | Thinking OFF | Effort levels                              | 備考                       |
| ------------------- | -----------: | ------------------------------------------ | ------------------------ |
| OpenAI Astra        |            × | `low / medium / high / xhigh / max`        | `none`なし                 |
| OpenAI Sol          |            ○ | `none / low / medium / high / xhigh / max` | `none` = 実質OFF           |
| OpenAI Terra        |            ○ | `none / low / medium / high / xhigh / max` | 同上                       |
| OpenAI Luna         |            ○ | `none / low / medium / high / xhigh / max` | 同上                       |
| Anthropic Opus      |            ○ | `low / medium / high / xhigh / max`        | `adaptive`はeffortではない    |
| Anthropic Sonnet    |            ○ | `low / medium / high / xhigh / max`        | thinkingをOFF可能           |
| Anthropic Fable     |            × | `low / medium / high / xhigh / max`        | thinking常時ON、adaptive    |
| Anthropic Haiku 4.5 |          ○相当 | effortなし                                   | 現行effort API非対応          |
| DeepSeek Flash      |            ○ | `none / low / high / max`                  | `medium/xhigh`は独立レベルではない |

Anthropicだけ少し構造が違います。

```ts
thinking: {
  type: "adaptive"
}

output_config: {
  effort: "high"
}
```

Anthropicのモデル別では、

```text
Opus
off
adaptive + low/medium/high/xhigh/max

Sonnet
off
adaptive + low/medium/high/xhigh/max

Fable
adaptive + low/medium/high/xhigh/max
# OFF不可
```

という理解でよいです。
