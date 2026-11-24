import { NextResponse } from "next/server";
import {
  generateImportTemplate,
  isSupportedTemplateFormat,
  SUPPORTED_TEMPLATE_FORMATS,
} from "@/lib/import";
import { apiError, handleApiError } from "@/lib/security/errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ format: string }> },
) {
  try {
    const { format } = await context.params;
    const normalized = format.trim().toLowerCase();

    if (!isSupportedTemplateFormat(normalized)) {
      return apiError(
        "BAD_REQUEST",
        `Unsupported template format "${format}". Supported: ${SUPPORTED_TEMPLATE_FORMATS.join(", ")}.`,
        400,
      );
    }

    const template = await generateImportTemplate(normalized);

    return new NextResponse(Buffer.from(template.content), {
      status: 200,
      headers: {
        "Content-Type": template.contentType,
        "Content-Disposition": `attachment; filename="${template.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
