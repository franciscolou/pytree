export interface SvgProps {
    id?: string;
    className?: string;
    width: string | number;
    height: string | number;
    viewBox?: string;
    children: string;
}

export function Svg({
    width,
    height,
    viewBox,
    className,
    children,
}: SvgProps): string {
    return `
<svg
  id="svgRoot"
  ${className ? `class="${className}"` : ''}
  width="${width}"
  height="${height}"
  ${viewBox ? `viewBox="${viewBox}"` : ''}
  xmlns="http://www.w3.org/2000/svg"
>
${children}
</svg>
`;
}
