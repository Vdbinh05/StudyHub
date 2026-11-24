"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import type { DailyActivityPoint } from "./analytics-types";

interface ActivityChartProps {
  data: DailyActivityPoint[];
  variant?: "bar" | "area";
  height?: number;
}

export function ActivityChart({
  data,
  variant = "bar",
  height = 240,
}: ActivityChartProps) {
  const { locale } = useI18n();
  const vi = locale === "vi";

  if (data.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center text-sm"
        style={{ height }}
      >
        {vi ? "Chưa có dữ liệu hoạt động." : "No activity data yet."}
      </div>
    );
  }

  const answeredLabel = vi ? "Câu đã làm" : "Answered";
  const correctLabel = vi ? "Câu đúng" : "Correct";

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        {vi
          ? "Biểu đồ số câu hỏi đã trả lời theo ngày"
          : "Daily study activity chart showing questions answered"}
      </figcaption>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          {variant === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  borderColor: "var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                  fontSize: "12px",
                }}
                formatter={(value: unknown, name: unknown) => [
                  String(value ?? 0),
                  name === "answered" ? answeredLabel : correctLabel,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: "12px" }}
                formatter={(value) =>
                  value === "answered" ? answeredLabel : correctLabel
                }
              />
              <Area
                type="monotone"
                dataKey="answered"
                name="answered"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.14}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="correct"
                name="correct"
                stroke="var(--chart-3)"
                fill="var(--chart-3)"
                fillOpacity={0.1}
                strokeWidth={2}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  borderColor: "var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                  fontSize: "12px",
                }}
                formatter={(value: unknown, name: unknown) => [
                  String(value ?? 0),
                  name === "answered" ? answeredLabel : correctLabel,
                ]}
              />
              <Bar
                dataKey="answered"
                name="answered"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {/* Screen-reader accessible tabular alternative */}
      <table className="sr-only">
        <caption>{vi ? "Dữ liệu hoạt động theo ngày" : "Daily study activity data"}</caption>
        <thead>
          <tr>
            <th scope="col">{vi ? "Ngày" : "Date"}</th>
            <th scope="col">{answeredLabel}</th>
            <th scope="col">{correctLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <td>{point.label}</td>
              <td>{point.answered}</td>
              <td>{point.correct}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface AccuracyTrendChartProps {
  data: Array<{ label: string; accuracy: number; title?: string }>;
  height?: number;
}

export function AccuracyTrendChart({ data, height = 240 }: AccuracyTrendChartProps) {
  const { locale } = useI18n();
  const vi = locale === "vi";

  if (data.length === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center text-sm"
        style={{ height }}
      >
        {vi ? "Chưa có xu hướng độ chính xác." : "No accuracy trend yet."}
      </div>
    );
  }

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        {vi ? "Biểu đồ xu hướng độ chính xác" : "Accuracy trend chart"}
      </figcaption>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                borderColor: "var(--border)",
                borderRadius: "8px",
                color: "var(--popover-foreground)",
                fontSize: "12px",
              }}
              formatter={(value: unknown) => [
                `${Number(value ?? 0)}%`,
                vi ? "Độ chính xác" : "Accuracy",
              ]}
            />
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="var(--chart-2)"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: "var(--chart-2)" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{vi ? "Dữ liệu xu hướng độ chính xác" : "Accuracy trend data"}</caption>
        <thead>
          <tr>
            <th scope="col">{vi ? "Thời điểm" : "Date"}</th>
            <th scope="col">{vi ? "Độ chính xác" : "Accuracy"}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={`${row.label}-${idx}`}>
              <td>{row.title ?? row.label}</td>
              <td>{row.accuracy}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
