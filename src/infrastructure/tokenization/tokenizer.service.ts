import { countTokens, decode, encode } from "bpe-lite";
import { Tokenizer } from "./tokenizer.types.js";

export class TokenizerService implements Tokenizer {
  count(text: string): number {
    return countTokens(text, "gemini");
  }

  tokenize(text: string): number[] {
    return encode(text, "gemini");
  }

  detokenize(tokens: number[]): string {
    return decode(tokens, "gemini");
  }
}
