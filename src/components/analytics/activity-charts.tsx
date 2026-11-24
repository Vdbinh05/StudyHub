"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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

  return (
    <div style={{ width: "100%", height }} aria-label={vi ? "Biểu đồ hoạt động học tập" : "Study activity chart"}>
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
              formatter={(value: unknown, name: unknown) => {
                const label =
                  name === "answered"
                    ? vi
                      ? "Câu đã làm"
                      : "Answered"
                    : vi
                      ? "Câu đúng"
                      : "Correct";
                return [String(value ?? 0), label];
              }}
            />
            <Area
              type="monotone"
              dataKey="answered"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.14}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="correct"
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
              formatter={(value: unknown, name: unknown) => {
                const label =
                  name === "answered"
                    ? vi
                      ? "Câu đã làm"
                      : "Answered"
                    : vi
                      ? "Câu đúng"
                      : "Correct";
                return [String(value ?? 0), label];
              }}
            />
            <Bar
              dataKey="answered"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
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
    <div style={{ width: "100%", height }} aria-label={vi ? "Biểu đồ xu hướng độ chính xác" : "Accuracy trend chart"}>
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
  );
}
