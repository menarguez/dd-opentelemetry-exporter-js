/*
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the Apache 2.0 license (see LICENSE).
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2020 Datadog, Inc.
 */

import {
  Context,
  GetterFunction,
  HttpTextPropagator,
  SetterFunction,
  TraceFlags,
  SpanContext,
} from '@opentelemetry/api';
import {
  getParentSpanContext,
  setExtractedSpanContext,
  TraceState,
} from '@opentelemetry/core';
import { id } from './types';
import { DatadogPropagationDefaults, DatadogDefaults } from './defaults';

const VALID_TRACEID_REGEX = /^([0-9a-f]{16}){1,2}$/i;
const VALID_SPANID_REGEX = /^[0-9a-f]{16}$/i;
const INVALID_ID_REGEX = /^0+$/i;

function isValidTraceId(traceId: string): boolean {
  return VALID_TRACEID_REGEX.test(traceId) && !INVALID_ID_REGEX.test(traceId);
}

function isValidSpanId(spanId: string): boolean {
  return VALID_SPANID_REGEX.test(spanId) && !INVALID_ID_REGEX.test(spanId);
}

/**
 * Propagator for the Datadog HTTP header format.
 * Based on: https://github.com/DataDog/dd-trace-js/blob/master/packages/dd-trace/src/opentracing/propagation/text_map.js
 */
export class DatadogPropagator implements HttpTextPropagator {
  inject(context: Context, carrier: unknown, setter: SetterFunction): void {
    const spanContext = getParentSpanContext(context);

    if (!spanContext) return;

    if (
      isValidTraceId(spanContext.traceId) &&
      isValidSpanId(spanContext.spanId)
    ) {
      const ddTraceId = id(spanContext.traceId).toString(10);
      const ddSpanId = id(spanContext.spanId).toString(10);

      setter(carrier, DatadogPropagationDefaults.X_DD_TRACE_ID, ddTraceId);
      setter(carrier, DatadogPropagationDefaults.X_DD_PARENT_ID, ddSpanId);

      // Current Otel-DD exporter behavior in other languages is to set to zero if falsey
      setter(
        carrier,
        DatadogPropagationDefaults.X_DD_SAMPLING_PRIORITY,
        (TraceFlags.SAMPLED & spanContext.traceFlags) === TraceFlags.SAMPLED
          ? '1'
          : '0'
      );

      // Current Otel-DD exporter behavior in other languages is to only set origin tag
      // if it exists, otherwise don't set header
      if (
        spanContext.traceState !== undefined &&
        spanContext.traceState.get(DatadogDefaults.OT_ALLOWED_DD_ORIGIN)
      ) {
        setter(
          carrier,
          DatadogPropagationDefaults.X_DD_ORIGIN,
          spanContext.traceState.get(DatadogDefaults.OT_ALLOWED_DD_ORIGIN)
        );
      }
    }
  }

  extract(context: Context, carrier: unknown, getter: GetterFunction): Context {
    const traceIdHeader = getter(
      carrier,
      DatadogPropagationDefaults.X_DD_TRACE_ID
    );
    const spanIdHeader = getter(
      carrier,
      DatadogPropagationDefaults.X_DD_PARENT_ID
    );
    const sampledHeader = getter(
      carrier,
      DatadogPropagationDefaults.X_DD_SAMPLING_PRIORITY
    );
    const originHeader = getter(
      carrier,
      DatadogPropagationDefaults.X_DD_ORIGIN
    );

    // I suppose header formats can format these as arrays
    // keeping this from b3propagator
    const traceIdHeaderValue = Array.isArray(traceIdHeader)
      ? traceIdHeader[0]
      : traceIdHeader;
    const spanIdHeaderValue = Array.isArray(spanIdHeader)
      ? spanIdHeader[0]
      : spanIdHeader;

    const sampled = Array.isArray(sampledHeader)
      ? sampledHeader[0]
      : sampledHeader;

    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

    // check if we've extracted a trace and span
    if (!traceIdHeaderValue || !spanIdHeaderValue) {
      return context;
    }

    // TODO: is this accurate?
    const traceId = id(traceIdHeaderValue, 10).toString('hex');
    const spanId = id(spanIdHeaderValue, 10).toString('hex');

    if (isValidTraceId(traceId) && isValidSpanId(spanId)) {
      const contextOptions: SpanContext = {
        traceId: traceId,
        spanId: spanId,
        isRemote: true,
        traceFlags: isNaN(Number(sampled)) ? TraceFlags.NONE : Number(sampled),
      };

      if (origin) {
        contextOptions[DatadogDefaults.TRACE_STATE] = new TraceState(
          `${DatadogDefaults.OT_ALLOWED_DD_ORIGIN}=${origin}`
        );
      }
      return setExtractedSpanContext(context, contextOptions);
    }
    return context;
  }
}
