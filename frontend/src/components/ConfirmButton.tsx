import { useState } from "react";
import type { ReactNode } from "react";

interface Props {
  onConfirm: () => void;
  /** 未点开时的按钮文字/内容 */
  children: ReactNode;
  /** 点开后的确认文字 */
  confirmLabel?: string;
  cancelLabel?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * 原地两级删除确认：第一次点按把按钮变成「确认/取消」，不再弹浏览器确认框。
 */
export default function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  className = "",
  title,
  ariaLabel,
}: Props) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        className={`confirm-btn ${className}`}
        title={title}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setArmed(true);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <span
      className={`confirm-inline ${className}`}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        className="confirm yes"
        aria-label={confirmLabel}
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="confirm no"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
        }}
      >
        {cancelLabel}
      </button>
    </span>
  );
}
