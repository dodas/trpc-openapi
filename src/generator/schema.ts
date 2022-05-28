import { TRPCError } from '@trpc/server';
import { OpenAPIV3 } from 'openapi-types';
import { AnyZodObject, ZodString, z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const zodSchemaToOpenApiSchemaObject = (zodSchema: z.ZodType): OpenAPIV3.SchemaObject => {
  return zodToJsonSchema(zodSchema, { target: 'openApi3' });
};

const zodInstanceofZodType = (schema: any): schema is z.ZodType => {
  return !!schema?._def?.typeName;
};

const zodInstanceof = <Z extends z.ZodFirstPartyTypeKind>(
  schema: any,
  zodTypeKind: Z,
): schema is InstanceType<typeof z[Z]> => {
  return schema?._def?.typeName === zodTypeKind;
};

const getBaseZodType = (schema: z.ZodType): z.ZodType => {
  if (
    zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodOptional)
    // zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodNullable) // nullable not valid in getParameterObjects
  ) {
    return getBaseZodType(schema.unwrap());
  }
  if (zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodDefault)) {
    return getBaseZodType(schema.removeDefault());
  }
  if (zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodEffects)) {
    return getBaseZodType(schema.innerType());
  }
  // TODO: ZodLazy?
  return schema;
};

export const getParameterObjects = (
  schema: unknown,
  path: string,
): OpenAPIV3.ParameterObject[] | undefined => {
  if (!zodInstanceofZodType(schema)) {
    throw new TRPCError({
      message: 'Input parser expects ZodType',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  if (!zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodObject)) {
    throw new TRPCError({
      message: 'Input parser expects ZodObject',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const { pathParams, restParams } = extractPathSchema(schema, path);

  const restParamObjects = Object.fromEntries(
    Object.keys(restParams.shape).map((key) => {
      const value = restParams.shape[key];

      if (!zodInstanceof(getBaseZodType(value), z.ZodFirstPartyTypeKind.ZodString)) {
        throw new TRPCError({
          message: 'Input parser expects ZodObject<{ [string]: ZodString }>',
          code: 'INTERNAL_SERVER_ERROR',
        });
      }

      const type = value as ZodString;

      return [
        key,
        {
          name: key,
          in: 'query',
          required: !type.isOptional(),
          schema: zodSchemaToOpenApiSchemaObject(type),
          style: 'form',
          explode: true,
        },
      ];
    }),
  );

  const pathParamObjects = schemaToPathParameterObjects(pathParams);

  return Object.values({
    ...restParamObjects,
    ...pathParamObjects,
  });
};

export const getMutationInputObjects = (
  schema: unknown,
  path: string,
): {
  requestBody: OpenAPIV3.RequestBodyObject | undefined;
  parameters: OpenAPIV3.ParameterObject[] | undefined;
} => {
  if (!zodInstanceofZodType(schema)) {
    throw new TRPCError({
      message: 'Input parser expects ZodType',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const { pathParams, restParams } = extractPathSchema(schema, path);
  const pathParamObjects = schemaToPathParameterObjects(pathParams);
  const requestBodySchema = zodSchemaToOpenApiSchemaObject(restParams);

  return {
    requestBody: {
      required: !restParams.isOptional(),
      content: {
        'application/json': {
          schema: requestBodySchema,
        },
      },
    },
    parameters: Object.values(pathParamObjects),
  };
};

export const errorResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: zodSchemaToOpenApiSchemaObject(
        z.object({
          ok: z.literal(false),
          error: z.object({
            message: z.string(),
            code: z.string(),
            issues: z.array(z.object({ message: z.string() })).optional(),
          }),
        }),
      ),
    },
  },
};

export const getResponsesObject = (schema: unknown): OpenAPIV3.ResponsesObject => {
  if (!zodInstanceofZodType(schema)) {
    throw new TRPCError({
      message: 'Output parser expects ZodType',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  const successResponseObject = {
    description: 'Successful response',
    content: {
      'application/json': {
        schema: zodSchemaToOpenApiSchemaObject(
          z.object({
            ok: z.literal(true),
            data: schema,
          }),
        ),
      },
    },
  };

  return {
    200: successResponseObject,
    default: { $ref: '#/components/responses/error' },
  };
};

const extractPathSchema = (schema: unknown, path: string) => {
  if (!zodInstanceofZodType(schema)) {
    throw new TRPCError({
      message: 'Input parser expects ZodType',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }

  if (!zodInstanceof(schema, z.ZodFirstPartyTypeKind.ZodObject)) {
    throw new TRPCError({
      message: 'Input parser expects ZodObject',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
  const { shape } = schema;

  const pathParams: AnyZodObject = z.object(
    Object.fromEntries(
      // Extract segments wrapped in curly braces
      Array.from(path.matchAll(/\{(\w+)\}/g))
        // Get just the inner content within braces
        .map((m) => m[1])
        .map((key) => {
          if (!key) {
            throw new TRPCError({
              message: `An invalid dynamic URL segment found.`,
              code: 'INTERNAL_SERVER_ERROR',
            });
          }

          const inputParam = shape[key];

          if (inputParam == null) {
            throw new TRPCError({
              message: `A dynamic segment found with no matching input parameter: ${key}`,
              code: 'INTERNAL_SERVER_ERROR',
            });
          }

          return [key, inputParam];
        }),
    ),
  );

  const restParams: AnyZodObject = schema.omit(
    Object.fromEntries(Object.keys(pathParams).map((k) => [k, true])),
  );

  return {
    pathParams,
    restParams,
  };
};

const schemaToPathParameterObjects = (schema: AnyZodObject) => {
  return Object.fromEntries(
    Object.keys(schema.shape).map((key) => {
      const value = schema.shape[key]!;

      if (!zodInstanceof(getBaseZodType(value), z.ZodFirstPartyTypeKind.ZodString)) {
        throw new TRPCError({
          message: 'Input parser expects ZodObject<{ [string]: ZodString }>',
          code: 'INTERNAL_SERVER_ERROR',
        });
      }

      const type = value as ZodString;

      return [
        key,
        {
          name: key,
          in: 'path',
          required: !type.isOptional(),
          schema: zodSchemaToOpenApiSchemaObject(type),
          style: 'simple',
          explode: true,
        },
      ];
    }),
  );
};
