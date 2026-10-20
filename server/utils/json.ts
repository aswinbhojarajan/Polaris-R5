import { z } from 'zod';

export interface JsonExtractionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function extractJson(raw: string): JsonExtractionResult {
  if (!raw || typeof raw !== 'string') {
    return {
      success: false,
      error: 'Input is empty or not a string',
    };
  }

  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return {
      success: true,
      data: parsed,
    };
  } catch (directError) {
    const fencePatterns = [
      /```json\s*([\s\S]*?)\s*```/i,
      /```\s*([\s\S]*?)\s*```/,
      /`([\s\S]*?)`/,
    ];

    for (const pattern of fencePatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          return {
            success: true,
            data: parsed,
          };
        } catch {
          continue;
        }
      }
    }

    const jsonObjectPattern = /\{[\s\S]*\}/;
    const jsonArrayPattern = /\[[\s\S]*\]/;

    for (const pattern of [jsonObjectPattern, jsonArrayPattern]) {
      const match = trimmed.match(pattern);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return {
            success: true,
            data: parsed,
          };
        } catch {
          continue;
        }
      }
    }

    return {
      success: false,
      error: `Failed to parse JSON: ${directError instanceof Error ? directError.message : 'Unknown error'}`,
    };
  }
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function validateJson<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): ValidationResult<T> {
  try {
    const validated = schema.parse(data);
    return {
      success: true,
      data: validated,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join('; ');
      return {
        success: false,
        error: `Validation failed: ${issues}`,
      };
    }
    return {
      success: false,
      error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export function extractAndValidateJson<T>(
  raw: string,
  schema: z.ZodSchema<T>
): ValidationResult<T> {
  const extraction = extractJson(raw);
  
  if (!extraction.success) {
    return {
      success: false,
      error: extraction.error,
    };
  }

  return validateJson(extraction.data, schema);
}
