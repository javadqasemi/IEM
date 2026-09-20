/**
 * Forms — the label/input/error contract, and the renderer built on it.
 *
 * `Field` owns the accessibility wiring so no screen has to remember it.
 * Everything that takes user input goes through it; a bare `<input>` in a
 * screen is a missing label waiting to be found by axe rather than by review.
 */
export { Field } from "./Field";
export { Input, Textarea, Select, Checkbox, Toggle, SearchInput } from "./inputs";
export { OtpInput, RecoveryCodeInput } from "./OtpInput";
export { FieldRenderer } from "./FieldRenderer";
export { Combobox, type ComboboxOption } from "./Combobox";
export { EntityPicker, type EntityOption } from "./EntityPicker";
export { DatePicker, DateInput } from "./DatePicker";
export {
  DateRangePicker,
  rangePresets,
  EMPTY_RANGE,
  type DateRange,
} from "./DateRangePicker";
export { Form, FormSection, FormActions } from "./Form";
export { SaveBar } from "./SaveBar";
export { EntityForm } from "./EntityForm";
export { useForm, type FormState, type UseFormOptions } from "./useForm";
export type { FieldDef, FieldErrors } from "./types";
