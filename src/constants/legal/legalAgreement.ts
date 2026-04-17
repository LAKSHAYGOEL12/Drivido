export type LegalAgreementSection = {
  title: string;
  lines: string[];
};

export const LEGAL_AGREEMENT_VERSION = '2026-04-15';
export const LEGAL_AGREEMENT_EFFECTIVE_DATE = '15 Apr 2026';
export const LEGAL_AGREEMENT_TITLE = 'User Agreement, Terms, and Privacy';

/**
 * Source provided by the product team as a DOCX file:
 * /Users/ofs/Downloads/Carpool_Legal_Detailed.docx
 */
export const LEGAL_AGREEMENT_SECTIONS: LegalAgreementSection[] = [
  {
    title: '1. Terms of Service',
    lines: [
      '1.1 Acceptance of Terms: By using this platform, you agree to be legally bound by these terms.',
      '1.2 Definitions: "Platform" means the mobile or web app operated by EcoPickO. "Driver" means a user offering rides. "Passenger" means a user booking rides.',
      '1.3 Nature of Service: The company acts as a technology intermediary and does not itself provide transport services.',
      '1.4 Eligibility: Users must be at least 18 years old and legally competent to contract under Indian law.',
      '1.5 Registration: You must provide accurate details and keep account credentials confidential.',
      '1.6 Driver Obligations: Drivers must maintain valid license, registration, and insurance, and comply with applicable motor vehicle laws.',
      '1.7 Passenger Obligations: Passengers must follow lawful and respectful behavior and complete required payments.',
      '1.8 Payments: Payments can be processed by third-party gateways. Service fees may apply.',
      '1.9 Cancellations: Cancellations are governed by platform cancellation rules.',
      '1.10 Prohibited Conduct: Illegal use, harassment, fraud, or misuse is prohibited.',
      '1.11 Suspension and Termination: Accounts can be suspended or terminated for violations.',
      '1.12 Limitation of Liability: The company is not liable for indirect damages or user-to-user disputes.',
      '1.13 Indemnity: Users agree to indemnify the company against related claims and liabilities.',
      '1.14 Governing Law: These terms are governed by the laws of India.',
    ],
  },
  {
    title: '2. Privacy Policy',
    lines: [
      '2.1 Data Collected: Name, contact details, location data, and device data may be collected.',
      '2.2 Purpose: Data is used for ride facilitation, safety, and analytics.',
      '2.3 Legal Basis: Processing is based on user consent and lawful purposes under DPDP Act 2023.',
      '2.4 Sharing: Data may be shared with other users, payment processors, and authorities when legally required.',
      '2.5 Retention: Data is retained only for as long as necessary.',
      '2.6 User Rights: You may request access, correction, and erasure, subject to legal requirements.',
      '2.7 Security: Reasonable safeguards are used to protect user data.',
      '2.8 Grievance Officer: Shivam Sharma, Contact: 9548190329, Email: Shivam.sharma12302@gmail.com.',
    ],
  },
  {
    title: '3. Driver Agreement',
    lines: [
      'Drivers are independent contractors.',
      'Drivers are responsible for maintaining valid license, insurance, and vehicle fitness.',
      'Drivers must comply with all applicable laws and regulations.',
      'No employer-employee relationship exists between drivers and the company.',
      'The company is not liable for driver conduct.',
    ],
  },
  {
    title: '4. Community Guidelines',
    lines: [
      'Users must maintain respectful behavior in all interactions.',
      'Illegal goods, harassment, abusive behavior, and misuse are prohibited.',
      'Violations can result in warnings, suspension, or account removal.',
    ],
  },
  {
    title: '5. Refund and Cancellation Policy',
    lines: [
      'Refund eligibility depends on cancellation timing and platform policy.',
      'No refunds are provided after ride completion.',
      'Approved refunds are typically processed within 5 to 7 business days.',
    ],
  },
  {
    title: '6. Disclaimer',
    lines: [
      'The platform is provided on an "as is" basis without warranties.',
      'The company does not guarantee safety, availability, uptime, or data accuracy at all times.',
    ],
  },
  {
    title: '7. Additional Legal Clauses',
    lines: [
      'Force Majeure: The company is not liable for events beyond reasonable control.',
      'Severability: If one clause is invalid, remaining clauses continue in effect.',
      'Entire Agreement: These terms form the complete agreement between users and the company.',
      'Amendments: Terms may be updated from time to time. Continued use indicates acceptance of updates.',
    ],
  },
];
