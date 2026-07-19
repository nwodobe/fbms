/* RCN TRACE - Factory hardening extension.
   Adds configurable quality, physical BIN controls, distinct drying/sorting,
   WIP and warehouse-to-production handover without breaking legacy data. */
(function(g){
"use strict";
var KEY="rcntrace.factory.v1";
var SB_URL="https://jmbdgpdthzpszfnddwzi.supabase.co";
var SB_ANON="sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d";
function now(){return new Date().toISOString();}
function n(v){var x=Number(v);return isFinite(x)?x:0;}