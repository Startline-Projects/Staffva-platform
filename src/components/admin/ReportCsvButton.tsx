"use client";

import type { Report } from "@/lib/adminReports";

/**
 * Download the report as CSV.
 *
 * The formula guard only prefixes cells that actually start a spreadsheet
 * formula: `=`, `+`, `@`, or a leading tab/CR. A leading `-` is deliberately
 * left alone — guarding it turns a negative number into text, which is how a
 * previous export broke SUM() over any column containing one.
 */
function csvCell(value: string | number): string {
  const s = String(value);
  const needsGuard = /^[=+@\t\r]/.test(s);
  const guarded = needsGuard ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export default function ReportCsvButton({ report }: { report: Report }) {
  function download() {
    const header = ["Value", "Count", "Share"];
    const lines = [
      header.map(csvCell).join(","),
      ...report.rows.map((r) => [r.value, r.count, `${(r.share * 100).toFixed(1)}%`].map(csvCell).join(",")),
      ["TOTAL", report.total, "100.0%"].map(csvCell).join(","),
    ];

    const window_ = [report.from, report.to].filter(Boolean).join(" to ");
    const preamble = [
      [`# ${report.dimension.label}`].map(csvCell).join(","),
      [`# ${window_ || "all time"}`].map(csvCell).join(","),
    ];

    const blob = new Blob([[...preamble, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.dimension.id}${window_ ? `_${report.from ?? "start"}_${report.to ?? "now"}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="adm-btn" onClick={download} disabled={report.total === 0}>
      Download CSV
    </button>
  );
}
