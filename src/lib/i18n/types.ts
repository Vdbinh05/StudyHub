import type { Locale } from "@/types/domain";
import type { viDictionary } from "./vi";

export type { Locale };

export type Dictionary = {
  [K in keyof typeof viDictionary]: {
    [P in keyof (typeof viDictionary)[K]]: string;
  };
};

type NestedKeyOf<T> = {
  [K in keyof T & string]: T[K] extends Record<string, string>
    ? `${K}.${keyof T[K] & string}`
    : K;
}[keyof T & string];

export type TranslationKey = NestedKeyOf<Dictionary>;
export type TranslationParams = Record<string, string | number>;
