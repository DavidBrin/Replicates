import { isValidElement, type ReactNode } from "react";

export interface InfoboxRow {
  label: string;
  value: ReactNode;
}

export interface InfoboxProps {
  title: string;
  image?: ReactNode;
  /**
   * The caption line under the infobox image. Defaults to the image's own
   * `alt` text, which is what it describes anyway — every article already
   * writes one, so a caption appears without duplicating that sentence into
   * each article module.
   */
  imageCaption?: ReactNode;
  rows: InfoboxRow[];
}

/** `alt` off an `<Image>`/`<img>` element, when the caller passed one. */
function altTextOf(image: ReactNode): string | undefined {
  if (!isValidElement<{ alt?: string }>(image)) return undefined;
  return typeof image.props.alt === "string" && image.props.alt.length > 0
    ? image.props.alt
    : undefined;
}

/**
 * The right-floating fact table. Geometry lives in `globals.css` under
 * `.infobox`, measured off the served page at 1440x900: `max-width:22em` at
 * 88% type (310px), 1px `#a2a9b1` border — not the lighter `#dadde3`
 * research/03 recorded — `#f8f9fa` ground, `border-spacing:3px`, and a
 * 125%-bold centred caption.
 *
 * The image occupies a full-width centred cell with its caption on the row
 * below it, matching how every Wikipedia article leads its infobox. The
 * label column is bold, left-aligned and top-aligned, and is allowed to
 * wrap: forcing `nowrap` (as this once did) makes a two-word label push the
 * value column off the 310px table.
 */
export function Infobox({ title, image, imageCaption, rows }: InfoboxProps) {
  const caption = imageCaption ?? altTextOf(image);

  return (
    <table className="infobox">
      <caption>{title}</caption>
      <tbody>
        {image && (
          <>
            <tr>
              <td colSpan={2} className="infobox-image">
                {image}
              </td>
            </tr>
            {caption && (
              <tr>
                <td colSpan={2} className="infobox-caption">
                  {caption}
                </td>
              </tr>
            )}
          </>
        )}
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="w-[30%]">
              {row.label}
            </th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
