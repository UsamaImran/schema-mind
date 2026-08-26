export interface Tokenizer {
  count(text: string): number;
  tokenize(text: string): number[];
  detokenize(tokens: number[]): string;
}
