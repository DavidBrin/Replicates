/**
 * fake-phone's own UI kit — used by the home and settings surfaces only.
 *
 * The call skins deliberately do NOT import from here: a skin is a replica and
 * must reach for its own platform's tokens, never our brand's
 * (`src/app/globals.css`). Mixing the two is what makes a replica read as "an
 * app pretending", which is the one thing this product cannot afford.
 */

export { Card, type CardProps } from "./card";
export { Field, type FieldControlProps, type FieldProps } from "./field";
export { PhotoPicker, type PhotoPickerProps } from "./photo-picker";
export { PrimaryButton, type PrimaryButtonProps } from "./primary-button";
export { SelectField, type SelectFieldProps, type SelectOption } from "./select-field";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./segmented-control";
export { Stepper, type StepperProps } from "./stepper";
export { TextField, type TextFieldProps } from "./text-field";
export { Toggle, type ToggleProps } from "./toggle";
export { MAX_PHOTO_EDGE, fileToDownscaledDataUrl } from "./image-downscale";
