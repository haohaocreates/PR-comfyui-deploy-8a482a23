import { db } from "@/db/db";
import {
  workflowAPIType,
  workflowTable,
  workflowType,
  workflowVersionTable,
} from "@/db/schema";
import { parseDataSafe } from "@/lib/parseDataSafe";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { z } from "zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const UploadRequest = z.object({
  // user_id: z.string(),
  workflow_id: z.string().optional(),
  workflow_name: z.string().optional(),
  workflow: workflowType,
  workflow_api: workflowAPIType,
});

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

const APIKeyBodyRequest = z.object({
  user_id: z.string().optional(),
  org_id: z.string().optional(),
  iat: z.number(),
});

function parseJWT(token: string) {
  try {
    // Verify the token - this also decodes it
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    return APIKeyBodyRequest.parse(decoded);
  } catch (err) {
    // Handle error (token is invalid, expired, etc.)
    console.error(err);
    return null;
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("Authorization")?.split(" ")?.[1]; // Assuming token is sent as "Bearer your_token"
  const userData = token ? parseJWT(token) : undefined;
  if (!userData) {
    return new NextResponse("Invalid or expired token", {
      status: 401,
      headers: corsHeaders,
    });
  }

  console.log(userData);

  const { user_id, org_id } = userData;

  if (!user_id) return new NextResponse("Invalid user_id", { status: 401 });

  const [data, error] = await parseDataSafe(
    UploadRequest,
    request,
    corsHeaders
  );

  if (!data || error) return error;

  const {
    // user_id,
    workflow,
    workflow_api,
    workflow_id: _workflow_id,
    workflow_name,
  } = data;

  let workflow_id = _workflow_id;

  let version = -1;

  // Case 1 new workflow
  try {
    if ((!workflow_id || workflow_id.length == 0) && workflow_name) {
      // Create a new parent workflow
      const workflow_parent = await db
        .insert(workflowTable)
        .values({
          user_id,
          name: workflow_name,
        })
        .returning();

      workflow_id = workflow_parent[0].id;

      // Create a new version
      const data = await db
        .insert(workflowVersionTable)
        .values({
          workflow_id: workflow_id,
          workflow,
          workflow_api,
          version: 1,
        })
        .returning();
      version = data[0].version;
    } else if (workflow_id) {
      // Case 2 update workflow
      const data = await db
        .insert(workflowVersionTable)
        .values({
          workflow_id,
          workflow: workflow,
          workflow_api,
          // version: sql`${workflowVersionTable.version} + 1`,
          version: sql`(
        SELECT COALESCE(MAX(version), 0) + 1
        FROM ${workflowVersionTable}
        WHERE workflow_id = ${workflow_id}
      )`,
        })
        .returning();
      version = data[0].version;
    } else {
      return NextResponse.json(
        {
          error: "Invalid request, missing either workflow_id or name",
        },
        {
          status: 500,
          statusText: "Invalid request",
          headers: corsHeaders,
        }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.toString(),
      },
      {
        status: 500,
        statusText: "Invalid request",
        headers: corsHeaders,
      }
    );
  }

  return NextResponse.json(
    {
      workflow_id: workflow_id,
      version: version,
    },
    {
      status: 200,
      headers: corsHeaders,
    }
  );
}
