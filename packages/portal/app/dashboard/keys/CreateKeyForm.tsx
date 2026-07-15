"use client";
import { useActionState } from "react";
import { createKeyAction, type CreateKeyState } from "./actions";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState | null, FormData>(
    () => createKeyAction(null),
    null,
  );
  return (
    <div>
      <form action={action}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "발급 중…" : "새 API 키 발급"}
        </button>
      </form>
      {state?.key && (
        <div className="reveal-key">
          {state.key}
          <div className="muted" style={{ marginTop: 8 }}>
            ⚠️ 이 키는 지금 한 번만 표시됩니다. 안전한 곳에 바로 복사·보관하세요.
          </div>
        </div>
      )}
    </div>
  );
}
