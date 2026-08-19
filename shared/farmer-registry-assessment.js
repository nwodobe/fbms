/* ANAGROCI FBMS - AFLP Farmer Registry Sustainability questionnaire helpers */
(function (global) {
  'use strict';
  var FR = global.AFLP_FARMER_REGISTRY = global.AFLP_FARMER_REGISTRY || {};
  if (FR.assessment) return;

  var ANSWERS = [
    { value: 'YES', label: 'Oui' },
    { value: 'NO', label: 'Non' },
    { value: 'PARTIAL', label: 'Partiel' },
    { value: 'UNKNOWN', label: 'Inconnu' },
    { value: 'NOT_VERIFIED', label: 'Non vérifié' },
    { value: 'NOT_APPLICABLE', label: 'Non applicable' }
  ];
  var EVIDENCE = [
    { value: 'DECLARED', label: 'Déclaré' },
    { value: 'OBSERVED', label: 'Observé' },
    { value: 'DOCUMENTED', label: 'Documenté' },
    { value: 'GPS_VERIFIED', label: 'GPS vérifié' },
    { value: 'AUDITED', label: 'Audité' }
  ];
  var DOMAINS = {
    AGRICULTURAL_PRACTICES: 'Pratiques agricoles',
    ENVIRONMENT: 'Environnement',
    PHYTOSANITARY_MANAGEMENT: 'Gestion phytosanitaire',
    SOCIAL_SAFETY: 'Social et sécurité'
  };
  var RISK_RANK = { NOT_ASSESSED: 0, LOW: 1, MEDIUM: 2, HIGH: 3, REVIEW_REQUIRED: 4 };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c];
    });
  }
  function optionHtml(options, selected) {
    return options.map(function (item) {
      return '<option value="' + esc(item.value) + '" '
        + (item.value === selected ? 'selected' : '') + '>' + esc(item.label) + '</option>';
    }).join('');
  }
  function arrayValue(value) { return Array.isArray(value) ? value : []; }
  function maxRisk(a, b) {
    return (RISK_RANK[a] || 0) >= (RISK_RANK[b] || 0) ? a : b;
  }
  function groupCatalog(catalog) {
    var groups = {};
    (catalog || []).filter(function (q) { return q.active !== false; }).sort(function (a, b) {
      return Number(a.sequence_no || 0) - Number(b.sequence_no || 0);
    }).forEach(function (q) {
      if (!groups[q.domain]) groups[q.domain] = [];
      groups[q.domain].push(q);
    });
    return groups;
  }
  function answerMap(rows) {
    var map = {};
    (rows || []).forEach(function (row) { if (row && row.question_code) map[row.question_code] = row; });
    return map;
  }

  function render(catalog, rows, options) {
    options = options || {};
    var prefix = options.prefix || 'frq';
    var readonly = !!options.readonly;
    var defaultEvidence = options.defaultEvidence || 'DECLARED';
    var map = answerMap(rows);
    var groups = groupCatalog(catalog);
    var html = '<div class="frq-root" data-prefix="' + esc(prefix) + '">';

    Object.keys(groups).forEach(function (domain) {
      html += '<section class="frq-domain"><div class="frq-domain-head"><h4>'
        + esc(DOMAINS[domain] || domain) + '</h4><span>' + groups[domain].length + ' critères</span></div>';
      groups[domain].forEach(function (q) {
        var current = map[q.question_code] || {};
        var answer = current.answer || '';
        var evidence = current.evidence_level || defaultEvidence;
        var riskAnswers = arrayValue(q.risk_trigger_answers);
        var risk = answer && riskAnswers.indexOf(answer) >= 0 ? q.risk_level : 'NONE';
        html += '<article class="frq-question" data-code="' + esc(q.question_code) + '">'
          + '<div class="frq-question-title"><span class="frq-code">' + esc(q.question_code) + '</span>'
          + '<div><b>' + esc(q.label_fr) + '</b>'
          + (q.guidance_fr ? '<small>' + esc(q.guidance_fr) + '</small>' : '') + '</div>'
          + '<span class="frq-risk frq-risk-' + esc(String(risk).toLowerCase()) + '">' + esc(risk === 'NONE' ? '—' : risk) + '</span></div>'
          + '<div class="frq-grid">'
          + '<label>Réponse<select id="' + prefix + '_answer_' + esc(q.question_code) + '" '
          + (readonly ? 'disabled' : '') + '><option value="">— Choisir —</option>'
          + optionHtml(ANSWERS, answer) + '</select></label>'
          + '<label>Niveau de preuve<select id="' + prefix + '_evidence_' + esc(q.question_code) + '" '
          + (readonly ? 'disabled' : '') + '>' + optionHtml(EVIDENCE, evidence) + '</select></label>'
          + '</div><label class="frq-observation">Observation<textarea id="' + prefix + '_observation_'
          + esc(q.question_code) + '" ' + (readonly ? 'disabled' : '') + ' placeholder="Faits observés, déclaration ou élément de preuve">'
          + esc(current.observation || '') + '</textarea></label></article>';
      });
      html += '</section>';
    });
    html += '</div>';
    return html;
  }

  function read(catalog, options) {
    options = options || {};
    var prefix = options.prefix || 'frq';
    var parentField = options.parentField || 'baseline_id';
    var parentId = options.parentId;
    var catalogVersion = options.catalogVersion || 'AFLP-SUST-2026.1';
    var existing = answerMap(options.existingRows || []);
    return (catalog || []).filter(function (q) { return q.active !== false; }).map(function (q) {
      var answerElement = document.getElementById(prefix + '_answer_' + q.question_code);
      var evidenceElement = document.getElementById(prefix + '_evidence_' + q.question_code);
      var observationElement = document.getElementById(prefix + '_observation_' + q.question_code);
      var old = existing[q.question_code] || {};
      var row = {
        id: old.id || (FR.syncEngine ? FR.syncEngine.uuid() : String(Date.now()) + q.question_code),
        question_code: q.question_code,
        catalog_version: catalogVersion,
        answer: answerElement ? answerElement.value : old.answer || '',
        evidence_level: evidenceElement ? evidenceElement.value : old.evidence_level || options.defaultEvidence || 'DECLARED',
        observation: observationElement ? observationElement.value.trim() || null : old.observation || null
      };
      row[parentField] = parentId;
      return row;
    });
  }

  function validate(catalog, rows) {
    var map = answerMap(rows);
    var missing = [];
    (catalog || []).filter(function (q) { return q.active !== false && q.required !== false; }).forEach(function (q) {
      if (!map[q.question_code] || !map[q.question_code].answer) missing.push(q.question_code);
    });
    return missing;
  }

  function riskPreview(catalog, rows) {
    var map = answerMap(rows);
    var risk = 'LOW';
    var reasons = [];
    var answered = 0;
    (catalog || []).filter(function (q) { return q.active !== false; }).forEach(function (q) {
      var row = map[q.question_code];
      if (!row || !row.answer) return;
      answered += 1;
      if (arrayValue(q.risk_trigger_answers).indexOf(row.answer) >= 0) {
        risk = maxRisk(risk, q.risk_level || 'MEDIUM');
        reasons.push({
          question_code: q.question_code,
          domain: q.domain,
          label: q.label_fr,
          answer: row.answer,
          risk_level: q.risk_level || 'MEDIUM',
          corrective_action: q.default_corrective_action || null,
          priority: q.default_priority || 'MEDIUM'
        });
      }
    });
    return { risk: answered ? risk : 'NOT_ASSESSED', reasons: reasons, answered: answered };
  }

  function answerLabel(value) {
    var found = ANSWERS.find(function (item) { return item.value === value; });
    return found ? found.label : value || '—';
  }

  FR.assessment = {
    version: '1.0.0',
    answers: ANSWERS,
    evidenceLevels: EVIDENCE,
    domains: DOMAINS,
    render: render,
    read: read,
    validate: validate,
    riskPreview: riskPreview,
    answerMap: answerMap,
    answerLabel: answerLabel,
    escape: esc
  };
})(window);
