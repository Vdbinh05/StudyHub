import { lText } from "@/components/learning/learning-copy";
import type {
  AllocationStrategy,
  Locale,
  SelectionPolicy,
} from "@/types/domain";

export function getAllocationLabel(
  locale: Locale,
  strategy: AllocationStrategy,
): string {
  switch (strategy) {
    case "global_random":
      return lText(locale, "Ngẫu nhiên toàn bộ", "Global Random");
    case "equal":
      return lText(locale, "Chia đều môn", "Equal Split");
    case "proportional":
      return lText(locale, "Theo tỷ lệ môn", "Proportional");
    case "custom":
      return lText(locale, "Tự nhập từng môn", "Custom Counts");
    case "weighted":
      return lText(locale, "Tỷ trọng %", "Weighted %");
  }
}

export function getPolicyLabel(
  locale: Locale,
  policy: SelectionPolicy,
): string {
  switch (policy) {
    case "random":
      return lText(locale, "Ngẫu nhiên", "Random");
    case "unseen_first":
      return lText(locale, "Ưu tiên chưa làm", "Unseen First");
    case "mistakes_first":
      return lText(locale, "Ưu tiên câu sai", "Mistakes First");
    case "weak_topics_first":
      return lText(locale, "Chủ đề yếu trước", "Weak Topics First");
    case "due_for_review":
      return lText(locale, "Đến hạn SM-2", "SM-2 Due First");
    case "starred_only":
      return lText(locale, "Chỉ câu gắn sao", "Starred Only");
    case "incorrect_only":
      return lText(locale, "Chỉ câu đã sai", "Incorrect Only");
    case "anti_repeat":
      return lText(locale, "Hạn chế lặp lại", "Anti-Repeat");
  }
}

export function localizeAllocationError(
  locale: Locale,
  code?: string,
  fallbackMessage?: string,
  available?: number,
): string {
  if (locale === "en") {
    return fallbackMessage ?? "Invalid exam configuration.";
  }

  switch (code) {
    case "EMPTY_SUBJECTS":
      return "Vui lòng chọn ít nhất một học phần hoặc thư mục.";
    case "NO_ELIGIBLE_QUESTIONS":
      return "Không có câu hỏi khả dụng cho nguồn và bộ lọc đã chọn.";
    case "INVALID_NUMBER":
    case "NON_INTEGER":
      return "Số lượng câu hỏi phải là một số nguyên hợp lệ.";
    case "NON_POSITIVE":
      return "Số lượng câu hỏi phải lớn hơn 0.";
    case "EXCEEDS_AVAILABLE":
      return typeof available === "number"
        ? `Số câu yêu cầu vượt quá ngân hàng khả dụng (${available} câu).`
        : "Số câu yêu cầu vượt quá số câu khả dụng.";
    case "EXCEEDS_MAX_LIMIT":
      return "Số lượng câu hỏi vượt quá giới hạn tối đa cho một đề thi (1.000 câu).";
    case "CUSTOM_INVALID_COUNT":
      return "Số câu tùy chỉnh cho từng môn phải là số nguyên không âm.";
    case "CUSTOM_EXCEEDS_AVAILABLE":
      return "Số câu nhập cho một môn vượt quá số câu khả dụng của môn đó.";
    case "CUSTOM_SUM_MISMATCH":
      return "Tổng số câu phân bổ cho các môn chưa khớp với tổng số câu của đề.";
    case "WEIGHT_INVALID":
      return "Tỷ trọng phần trăm cho mỗi môn phải nằm trong khoảng 0–100%.";
    case "WEIGHTS_SUM_NOT_100":
      return "Tổng tỷ trọng các môn phải bằng đúng 100%.";
    default:
      return fallbackMessage ?? "Cấu hình đề thi chưa hợp lệ.";
  }
}
