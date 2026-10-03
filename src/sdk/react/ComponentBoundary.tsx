"use client";

import { Component, type ReactNode } from "react";

type Props = {
  componentId: string;
  /** Unique per surface instance so two previews never share element ids. */
  idPrefix: string;
  label: string;
  required: boolean;
  preview: boolean;
  children: ReactNode;
};

type State = { failed: boolean };

/**
 * Isolates one component's render failure. A failed required component (the
 * alerts panel) still renders a visible status so required information is
 * never silently hidden.
 */
export class ComponentBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[contour] component "${this.props.componentId}" failed to render`, error instanceof Error ? error.message : "");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { label, required, preview } = this.props;
    const headingId = `${this.props.idPrefix}-failed-${this.props.componentId}`;
    return (
      <section
        className="hc hc-failed"
        data-required={required ? "true" : "false"}
        aria-labelledby={headingId}
        role={required ? "status" : undefined}
      >
        <h3 id={headingId} className="hc-title">
          {label} unavailable
        </h3>
        <p className="hc-sub" style={{ color: "var(--color-ink-2)" }}>
          {required
            ? "This required panel couldn't be displayed. Check the source system directly before continuing, or reload the page."
            : "This part of your view couldn't be displayed. The rest of the page still works."}
        </p>
        {!preview && (
          <button type="button" className="btn btn-sm mt-3" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        )}
      </section>
    );
  }
}
