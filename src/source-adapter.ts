namespace TanYue {
  export class SourceAdapterError extends Error {
    constructor(
      public readonly code: SourceAdapterErrorCode,
      message: string,
      public readonly cause?: unknown
    ) {
      super(message);
      this.name = "SourceAdapterError";
    }
  }

  export async function selectSourceAdapter<Input>(
    input: Input,
    adapters: Array<SourceAdapter<Input>>
  ): Promise<SourceAdapter<Input>> {
    let selected: SourceAdapter<Input> | null = null;
    let bestConfidence = 0;

    for (const adapter of adapters) {
      const confidence = clamp(await adapter.detect(input), 0, 1);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        selected = adapter;
      }
    }

    if (!selected || bestConfidence <= 0) {
      throw new SourceAdapterError("unsupported_format", "当前没有可处理此格式的来源适配器。");
    }
    return selected;
  }

  export function createTextSourceAdapters(): Array<SourceAdapter<TextSourceInput>> {
    return [new PlainTextSourceAdapter()];
  }

  export async function parseTextSource(input: TextSourceInput): Promise<NormalizedDocument> {
    const adapter = await selectSourceAdapter(input, createTextSourceAdapters());
    try {
      return await adapter.parse(input);
    } finally {
      await adapter.dispose();
    }
  }
}
