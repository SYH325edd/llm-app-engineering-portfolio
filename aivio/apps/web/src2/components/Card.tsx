import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  subtle?: boolean;
};

export default function Card({ children, subtle = false, className = "", ...props }: CardProps) {
  return (
    <section className={`card ${subtle ? "card-subtle" : ""} ${className}`} {...props}>
      {children}
    </section>
  );
}
